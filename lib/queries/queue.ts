import type { Prisma, QueueEntry, QueueStatus } from "@prisma/client"
import { toZonedTime, fromZonedTime } from "date-fns-tz"
import { runWithRls } from "@/lib/db/rls"
import { isHoldingAdmin, requireClinicId, type AbilitySubject } from "@/lib/permissions/ability"
import { ForbiddenError } from "@/lib/permissions/errors"
import { toQueueEntryDTO, type QueueEntryDTO } from "@/lib/dto/queue-entry"
import { compareQueueOrder } from "@/lib/utils/queue-order"
import { sendNotification } from "@/lib/queries/notifications"

/**
 * Allocates the next queue number for a clinic/day inside an existing
 * transaction. §7.1: "queue_number resets daily per clinic. Generate it
 * inside a transaction so two simultaneous bookings can't collide."
 *
 * A plain `max(queueNumber) + 1` read-then-write inside a transaction isn't
 * actually safe under Postgres's default READ COMMITTED isolation — two
 * concurrent transactions can both read the same max before either commits
 * and then both try to insert the same number, colliding against the
 * `@@unique([clinicId, queueDate, queueNumber])` constraint. A
 * transaction-scoped advisory lock keyed on clinic+day serializes number
 * allocation for that key without taking a table-level lock or needing a
 * retry loop: the second transaction simply blocks here until the first
 * commits (releasing the lock automatically at commit/rollback).
 */
export async function nextQueueNumber(
  tx: Prisma.TransactionClient,
  clinicId: string,
  queueDate: Date
): Promise<number> {
  const dayKey = queueDate.toISOString().slice(0, 10)
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${clinicId + dayKey}))`

  const last = await tx.queueEntry.aggregate({
    where: { clinicId, queueDate },
    _max: { queueNumber: true },
  })
  return (last._max.queueNumber ?? 0) + 1
}

/**
 * Midnight UTC representing "today" in the *clinic's own* calendar day
 * (stored as a plain `@db.Date`) — not the server's or host machine's.
 * Manila is UTC+8, so naively using the server's UTC calendar date would
 * be a whole day behind Manila's actual date for the 16:00–23:59 UTC
 * window every day. `toZonedTime` shifts the instant so its **UTC**
 * getters read as the target zone's wall-clock time; reading it with plain
 * (non-UTC) getters would silently depend on the host machine's own
 * timezone matching — the exact bug this repo's history already caught
 * once in the availability engine (see DECISIONS.md, prior project).
 */
export function todayAsQueueDate(timezone: string): Date {
  const zoned = toZonedTime(new Date(), timezone)
  return new Date(Date.UTC(zoned.getUTCFullYear(), zoned.getUTCMonth(), zoned.getUTCDate()))
}

/** `queueDate` for "tomorrow" in the clinic's own calendar day — §7.1's same-day/next-day booking window. */
export function tomorrowAsQueueDate(timezone: string): Date {
  const today = todayAsQueueDate(timezone)
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1))
}

/**
 * The real UTC instants bounding "today" in the clinic's own timezone —
 * for filtering actual timestamps (e.g. `Payment.receivedAt`), which is
 * a different problem from `todayAsQueueDate`'s calendar-*label* (a
 * `@db.Date` column only ever stores Y-M-D, so a UTC-midnight stand-in for
 * that date is fine there). Manila midnight is UTC 16:00 the *previous*
 * day, 8 hours away from UTC midnight of the same Y-M-D digits — using
 * `todayAsQueueDate`'s value directly as an instant boundary would miss
 * every real timestamp in that 8-hour window. `fromZonedTime` re-reads the
 * UTC-constructed Y-M-D-00:00:00 as if it were *wall-clock time in the
 * target zone* and returns the correct absolute instant.
 */
export function todayInstantRange(timezone: string): { start: Date; end: Date } {
  const start = fromZonedTime(todayAsQueueDate(timezone), timezone)
  const end = fromZonedTime(tomorrowAsQueueDate(timezone), timezone)
  return { start, end }
}

export async function clinicTimezone(tx: Prisma.TransactionClient, clinicId: string): Promise<string> {
  const clinic = await tx.clinic.findUniqueOrThrow({ where: { id: clinicId }, select: { timezone: true } })
  return clinic.timezone
}

/** §7.3: entries physically present and eligible to be called next. */
export const ACTIVE_STATUSES: QueueStatus[] = ["CHECKED_IN", "WAITING"]

export type StaffQueueEntryDTO = QueueEntryDTO & {
  patientName: string
  patientAge: number
  doctorName: string | null
}

function toStaffQueueEntryDTO(
  entry: QueueEntry & {
    patient: { firstName: string; lastName: string; birthdate: Date }
    doctor: { user: { name: string } } | null
  }
): StaffQueueEntryDTO {
  const ageMs = Date.now() - entry.patient.birthdate.getTime()
  const patientAge = Math.floor(ageMs / (1000 * 60 * 60 * 24 * 365.25))
  return {
    ...toQueueEntryDTO(entry),
    patientName: `${entry.patient.lastName}, ${entry.patient.firstName}`,
    patientAge,
    doctorName: entry.doctor?.user.name ?? null,
  }
}

/** Today's full queue for the staff board — every status, so the UI can group upcoming/active/done. */
export async function listTodayQueue(user: AbilitySubject): Promise<StaffQueueEntryDTO[]> {
  if (isHoldingAdmin(user)) {
    throw new Error("listTodayQueue requires a clinic-scoped user")
  }
  const clinicId = requireClinicId(user)

  return runWithRls(user, async (tx) => {
    const timezone = await clinicTimezone(tx, clinicId)
    const queueDate = todayAsQueueDate(timezone)
    const entries = await tx.queueEntry.findMany({
      where: { clinicId, queueDate },
      include: { patient: { select: { firstName: true, lastName: true, birthdate: true } }, doctor: { include: { user: { select: { name: true } } } } },
      orderBy: { queueNumber: "asc" },
    })
    return entries.map(toStaffQueueEntryDTO)
  })
}

/** A doctor's own queue — only patients assigned to them, today, not yet completed. */
export async function listDoctorQueue(user: AbilitySubject): Promise<StaffQueueEntryDTO[]> {
  if (user.role !== "DOCTOR") {
    throw new ForbiddenError("Only doctors have a doctor queue")
  }
  const clinicId = requireClinicId(user)

  return runWithRls(user, async (tx) => {
    const doctor = await tx.doctor.findUnique({ where: { userId: user.id }, select: { id: true } })
    if (!doctor) return []
    const timezone = await clinicTimezone(tx, clinicId)
    const queueDate = todayAsQueueDate(timezone)
    const entries = await tx.queueEntry.findMany({
      where: { clinicId, queueDate, doctorId: doctor.id, status: { in: ["WAITING", "CALLED", "IN_CONSULTATION"] } },
      include: { patient: { select: { firstName: true, lastName: true, birthdate: true } }, doctor: { include: { user: { select: { name: true } } } } },
    })
    return entries.map(toStaffQueueEntryDTO).sort(compareQueueOrder)
  })
}

async function findClinicEntry(tx: Prisma.TransactionClient, clinicId: string, queueEntryId: string) {
  const entry = await tx.queueEntry.findFirst({ where: { id: queueEntryId, clinicId } })
  if (!entry) throw new ForbiddenError("Queue entry not found in your clinic")
  return entry
}

/**
 * §7.6 "~3 patients ahead" trigger. Not a single event — it's a condition
 * that becomes true as the queue advances, so this re-checks every active
 * entry after anything that could change someone's position (calling the
 * next patient, a no-show, or a manual reorder) and sends to whoever just
 * landed within 3 places of being called. Skips position 0 (they're about
 * to get the separate "now serving" notification directly) and anyone
 * already sent this for the same queue entry, so re-running it after every
 * queue change doesn't re-notify the same patient each time.
 */
async function notifyAlmostYourTurn(tx: Prisma.TransactionClient, clinicId: string, queueDate: Date): Promise<void> {
  const active = await tx.queueEntry.findMany({
    where: { clinicId, queueDate, status: { in: ACTIVE_STATUSES } },
    include: { patient: { select: { id: true, firstName: true, phone: true } } },
  })
  active.sort(compareQueueOrder)
  const targets = active.slice(1, 4)
  if (targets.length === 0) return

  const clinic = await tx.clinic.findUniqueOrThrow({ where: { id: clinicId }, select: { name: true } })
  for (const entry of targets) {
    const alreadySent = await tx.notification.findFirst({
      where: { queueEntryId: entry.id, templateKey: "almost_your_turn" },
      select: { id: true },
    })
    if (alreadySent) continue
    await sendNotification(tx, {
      clinicId,
      patientId: entry.patient.id,
      queueEntryId: entry.id,
      to: entry.patient.phone,
      channel: "SMS",
      templateKey: "almost_your_turn",
      payload: { patientName: entry.patient.firstName, clinicName: clinic.name, queueNumber: entry.queueNumber },
    })
  }
}

/** A booked (online/Facebook) patient has physically arrived — §7.1's booked → checked_in transition. */
export async function checkInBookedEntry(user: AbilitySubject, queueEntryId: string): Promise<QueueEntryDTO> {
  const clinicId = requireClinicId(user)
  return runWithRls(user, async (tx) => {
    const entry = await findClinicEntry(tx, clinicId, queueEntryId)
    if (entry.status !== "BOOKED") {
      throw new Error(`Cannot check in a queue entry with status ${entry.status}`)
    }
    const updated = await tx.queueEntry.update({
      where: { id: queueEntryId },
      data: { status: "CHECKED_IN", checkedInAt: new Date() },
    })
    await tx.auditLog.create({
      data: { clinicId, userId: user.id, action: "queue_entry.check_in", entityType: "QueueEntry", entityId: queueEntryId },
    })
    return toQueueEntryDTO(updated)
  })
}

/** Assigns (or reassigns) the doctor who'll see this patient; CHECKED_IN entries become WAITING once assigned. */
export async function assignDoctor(user: AbilitySubject, queueEntryId: string, doctorId: string): Promise<QueueEntryDTO> {
  const clinicId = requireClinicId(user)
  return runWithRls(user, async (tx) => {
    const entry = await findClinicEntry(tx, clinicId, queueEntryId)
    // Assignable any time before the consultation actually starts — a
    // patient can be called before staff has settled which doctor sees
    // them, so CALLED must stay assignable too. Only a CHECKED_IN entry's
    // *status* moves forward (to WAITING) on assignment; an already
    // WAITING or CALLED entry keeps its status and just gets/changes its
    // doctor.
    if (!ACTIVE_STATUSES.includes(entry.status) && entry.status !== "CALLED") {
      throw new Error(`Cannot assign a doctor to a queue entry with status ${entry.status}`)
    }
    const doctor = await tx.doctor.findFirst({ where: { id: doctorId, clinicId } })
    if (!doctor) throw new ForbiddenError("Doctor not found in your clinic")

    const updated = await tx.queueEntry.update({
      where: { id: queueEntryId },
      data: { doctorId, status: entry.status === "CHECKED_IN" ? "WAITING" : entry.status },
    })
    await tx.auditLog.create({
      data: {
        clinicId,
        userId: user.id,
        action: "queue_entry.assign_doctor",
        entityType: "QueueEntry",
        entityId: queueEntryId,
        changes: { doctorId },
      },
    })
    return toQueueEntryDTO(updated)
  })
}

/**
 * §12/M3's central action: calls the next eligible patient (priority
 * first, then check-in time). Serialized with the same transaction-scoped
 * advisory-lock pattern as `nextQueueNumber`, for the same reason — two
 * front-desk staff clicking "Call Next" at once must not both call the
 * same patient. Returns null when there's nobody left to call.
 */
export async function callNextEntry(user: AbilitySubject): Promise<StaffQueueEntryDTO | null> {
  const clinicId = requireClinicId(user)
  return runWithRls(user, async (tx) => {
    const timezone = await clinicTimezone(tx, clinicId)
    const queueDate = todayAsQueueDate(timezone)
    const dayKey = queueDate.toISOString().slice(0, 10)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${clinicId + dayKey + ":call"}))`

    const candidates = await tx.queueEntry.findMany({
      where: { clinicId, queueDate, status: { in: ACTIVE_STATUSES } },
      include: { patient: { select: { firstName: true, lastName: true, birthdate: true } }, doctor: { include: { user: { select: { name: true } } } } },
    })
    if (candidates.length === 0) return null
    candidates.sort(compareQueueOrder)
    const next = candidates[0]

    const updated = await tx.queueEntry.update({
      where: { id: next.id },
      data: { status: "CALLED", calledAt: new Date() },
      include: { patient: true, doctor: { include: { user: { select: { name: true } } } } },
    })
    await tx.auditLog.create({
      data: { clinicId, userId: user.id, action: "queue_entry.call_next", entityType: "QueueEntry", entityId: updated.id },
    })

    // §7.6 "Number called."
    const clinic = await tx.clinic.findUniqueOrThrow({ where: { id: clinicId }, select: { name: true } })
    await sendNotification(tx, {
      clinicId,
      patientId: updated.patientId,
      queueEntryId: updated.id,
      to: updated.patient.phone,
      channel: "SMS",
      templateKey: "now_serving",
      payload: { patientName: updated.patient.firstName, clinicName: clinic.name, queueNumber: updated.queueNumber },
    })
    // Calling someone moves everyone behind them one place closer.
    await notifyAlmostYourTurn(tx, clinicId, queueDate)

    return toStaffQueueEntryDTO(updated)
  })
}

/** Re-announces an already-called patient (e.g. they didn't hear it the first time) without changing their place in line. */
export async function recallEntry(user: AbilitySubject, queueEntryId: string): Promise<QueueEntryDTO> {
  const clinicId = requireClinicId(user)
  return runWithRls(user, async (tx) => {
    const entry = await findClinicEntry(tx, clinicId, queueEntryId)
    if (entry.status !== "CALLED") {
      throw new Error(`Cannot recall a queue entry with status ${entry.status}`)
    }
    const updated = await tx.queueEntry.update({ where: { id: queueEntryId }, data: { calledAt: new Date() } })
    await tx.auditLog.create({
      data: { clinicId, userId: user.id, action: "queue_entry.recall", entityType: "QueueEntry", entityId: queueEntryId },
    })
    return toQueueEntryDTO(updated)
  })
}

/** Marks a called (or still-waiting) patient as a no-show. */
export async function markNoShow(user: AbilitySubject, queueEntryId: string): Promise<QueueEntryDTO> {
  const clinicId = requireClinicId(user)
  return runWithRls(user, async (tx) => {
    const entry = await findClinicEntry(tx, clinicId, queueEntryId)
    if (![...ACTIVE_STATUSES, "CALLED"].includes(entry.status)) {
      throw new Error(`Cannot mark a queue entry with status ${entry.status} as no-show`)
    }
    const updated = await tx.queueEntry.update({
      where: { id: queueEntryId },
      data: { status: "NO_SHOW" },
      include: { patient: true },
    })
    await tx.auditLog.create({
      data: { clinicId, userId: user.id, action: "queue_entry.no_show", entityType: "QueueEntry", entityId: queueEntryId },
    })

    const clinic = await tx.clinic.findUniqueOrThrow({ where: { id: clinicId }, select: { name: true, phone: true } })
    await sendNotification(tx, {
      clinicId,
      patientId: updated.patientId,
      queueEntryId: updated.id,
      to: updated.patient.phone,
      channel: "SMS",
      templateKey: "no_show",
      payload: { patientName: updated.patient.firstName, clinicName: clinic.name, clinicPhone: clinic.phone },
    })
    // A no-show frees up the position everyone behind them was counting.
    await notifyAlmostYourTurn(tx, clinicId, entry.queueDate)

    return toQueueEntryDTO(updated)
  })
}

/** §7.4: doctor opens the patient and begins the consultation — requires a doctor already assigned. */
export async function startConsultationForQueueEntry(user: AbilitySubject, queueEntryId: string): Promise<QueueEntryDTO> {
  const clinicId = requireClinicId(user)
  return runWithRls(user, async (tx) => {
    const entry = await findClinicEntry(tx, clinicId, queueEntryId)
    if (entry.status !== "CALLED") {
      throw new Error(`Cannot start a consultation for a queue entry with status ${entry.status}`)
    }
    if (!entry.doctorId) {
      throw new Error("Assign a doctor before starting the consultation")
    }
    const updated = await tx.queueEntry.update({
      where: { id: queueEntryId },
      data: { status: "IN_CONSULTATION", startedAt: new Date() },
    })
    await tx.auditLog.create({
      data: { clinicId, userId: user.id, action: "queue_entry.start_consultation", entityType: "QueueEntry", entityId: queueEntryId },
    })
    return toQueueEntryDTO(updated)
  })
}

/**
 * Manual reorder (§7.3: "Staff can manually reorder by ... an up/down
 * control, and every manual reorder is written to the audit log"),
 * implemented as a swap of `checkedInAt` with the adjacent entry in the
 * *same priority tier* — moving a normal entry ahead of all normal but
 * still behind every priority entry stays consistent with the ordering
 * rule, without a separate manual-position column.
 */
export async function moveQueueEntryOrder(
  user: AbilitySubject,
  queueEntryId: string,
  direction: "up" | "down"
): Promise<void> {
  const clinicId = requireClinicId(user)
  await runWithRls(user, async (tx) => {
    const entry = await findClinicEntry(tx, clinicId, queueEntryId)
    if (!ACTIVE_STATUSES.includes(entry.status)) {
      throw new Error(`Cannot reorder a queue entry with status ${entry.status}`)
    }
    const tierMates = await tx.queueEntry.findMany({
      where: { clinicId, queueDate: entry.queueDate, status: { in: ACTIVE_STATUSES }, priority: entry.priority },
    })
    tierMates.sort(compareQueueOrder)
    const index = tierMates.findIndex((e) => e.id === entry.id)
    const swapIndex = direction === "up" ? index - 1 : index + 1
    if (swapIndex < 0 || swapIndex >= tierMates.length) return // already at the edge — no-op

    const neighbor = tierMates[swapIndex]
    await tx.queueEntry.update({ where: { id: entry.id }, data: { checkedInAt: neighbor.checkedInAt } })
    await tx.queueEntry.update({ where: { id: neighbor.id }, data: { checkedInAt: entry.checkedInAt } })
    await tx.auditLog.create({
      data: {
        clinicId,
        userId: user.id,
        action: "queue_entry.reorder",
        entityType: "QueueEntry",
        entityId: entry.id,
        changes: { direction, swappedWith: neighbor.id },
      },
    })
    await notifyAlmostYourTurn(tx, clinicId, entry.queueDate)
  })
}
