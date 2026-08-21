import type { Prisma } from "@prisma/client"
import { runWithRls } from "@/lib/db/rls"
import { isHoldingAdmin, requireClinicId, type AbilitySubject } from "@/lib/permissions/ability"
import { ForbiddenError } from "@/lib/permissions/errors"
import { toPatientDTO, type PatientDTO } from "@/lib/dto/patient"
import { toQueueEntryDTO, type QueueEntryDTO } from "@/lib/dto/queue-entry"
import { patientIntakeSchema } from "@/lib/validation/patient"
import { nextQueueNumber, todayAsQueueDate } from "@/lib/queries/queue"
import { generateAccessToken } from "@/lib/utils/token"

/**
 * Fetches one patient, scoped to the acting user's clinic. Returns:
 *  - the patient, if they belong to the user's clinic (or the user is a
 *    holding admin, who can see any clinic)
 *  - null, if no patient with that id exists at all
 *  - throws ForbiddenError, if the patient exists in a *different* clinic
 *
 * The last case is §12/M1's explicit bar: a direct-URL cross-clinic read
 * must 403, not silently 404 — so a broken scoping check is impossible to
 * miss. Postgres RLS (enable_rls_backstop migration) independently blocks
 * the underlying row from this connection regardless of this check, which
 * is why distinguishing "forbidden" from "genuinely missing" needs a
 * second, deliberately widened read (see inline comment below) rather than
 * just inspecting the first query's result.
 */
export async function getPatientById(
  user: AbilitySubject,
  patientId: string
): Promise<PatientDTO | null> {
  // A thrown error inside prisma.$transaction rolls back every write made
  // in that transaction, audit log included — so the "denied" branch can't
  // both throw ForbiddenError and have its audit row survive in one
  // transaction. Read (and, on denial, detect) inside the first
  // transaction; write whichever audit row applies in a second, separate
  // one; only then throw.
  const result = await runWithRls(user, async (tx) => {
    const patient = await tx.patient.findFirst({
      where: isHoldingAdmin(user)
        ? { id: patientId, deletedAt: null }
        : { id: patientId, clinicId: user.clinicId!, deletedAt: null },
    })
    if (patient) return { kind: "found" as const, patient }
    if (isHoldingAdmin(user)) return { kind: "not_found" as const }

    // Not visible under the user's own clinic scope. Widen RLS visibility
    // for this one lookup only, to tell "doesn't exist anywhere" apart from
    // "exists in a different clinic" — the same targeted, transaction-local
    // re-presentation pattern used for the completion write in the prior
    // build's scheduling layer. Never used to serve data back to the user,
    // only to log and 403 a genuine cross-clinic attempt per §10.
    await tx.$executeRaw`SELECT set_config('app.role', 'HOLDING_ADMIN', true)`
    const existsElsewhere = await tx.patient.findFirst({
      where: { id: patientId, deletedAt: null },
      select: { clinicId: true },
    })
    if (!existsElsewhere) return { kind: "not_found" as const }
    return { kind: "denied" as const, attemptedClinicId: existsElsewhere.clinicId }
  })

  if (result.kind === "found") {
    await runWithRls(user, (tx) =>
      tx.auditLog.create({
        data: {
          clinicId: result.patient.clinicId,
          userId: user.id,
          action: "patient.read",
          entityType: "Patient",
          entityId: patientId,
        },
      })
    )
    return toPatientDTO(result.patient)
  }

  if (result.kind === "not_found") return null

  await runWithRls(user, (tx) =>
    tx.auditLog.create({
      data: {
        clinicId: user.clinicId,
        userId: user.id,
        action: "patient.read.denied",
        entityType: "Patient",
        entityId: patientId,
        changes: { attemptedClinicId: result.attemptedClinicId },
      },
    })
  )
  throw new ForbiddenError("Cannot access a patient outside your clinic")
}

/** Lists patients in the acting user's own clinic (holding admins pass an explicit clinicId). */
export async function listPatients(
  user: AbilitySubject,
  opts: { clinicId?: string; search?: string } = {}
): Promise<PatientDTO[]> {
  const clinicId = isHoldingAdmin(user) ? opts.clinicId : user.clinicId!
  if (isHoldingAdmin(user) && !clinicId) {
    throw new Error("listPatients requires an explicit clinicId for a holding admin")
  }

  return runWithRls(user, async (tx) => {
    const patients = await tx.patient.findMany({
      where: {
        clinicId: clinicId!,
        deletedAt: null,
        ...(opts.search
          ? {
              OR: [
                { firstName: { contains: opts.search, mode: "insensitive" } },
                { lastName: { contains: opts.search, mode: "insensitive" } },
                { phone: { contains: opts.search } },
              ],
            }
          : {}),
      },
      orderBy: { lastName: "asc" },
      take: 50,
    })
    return patients.map(toPatientDTO)
  })
}

/**
 * Format-invariant duplicate check for §7.2's "phone-number search first to
 * avoid duplicates": strips everything but digits and compares the last 10
 * (a PH mobile number's length regardless of a leading +63 / 0 / spacing),
 * so "+63 917 000 1111" and "09170001111" match the same person.
 *
 * A DB-level `contains` can't do this normalization — a stored number like
 * "+63 917 555 0001" has a space inside almost any fixed-width digit
 * window, so a `contains` filter built from *normalized* digits routinely
 * misses rows whose *raw* text just happens to have punctuation in that
 * span. Filtering in JS after fetching the clinic's patients avoids that
 * false-negative class entirely; an MVP clinic's own patient roster (§13:
 * dozens to a few hundred) is small enough that this is a real query, not
 * a performance problem masquerading as a design choice.
 */
export async function searchPatientsByPhone(user: AbilitySubject, phone: string): Promise<PatientDTO[]> {
  if (isHoldingAdmin(user)) {
    throw new Error("searchPatientsByPhone requires a clinic-scoped user")
  }
  const digits = phone.replace(/\D/g, "").slice(-10)
  if (digits.length < 7) return []

  return runWithRls(user, async (tx) => {
    const patients = await tx.patient.findMany({
      where: { clinicId: user.clinicId!, deletedAt: null },
      orderBy: { lastName: "asc" },
    })
    return patients
      .filter((p) => p.phone.replace(/\D/g, "").slice(-10) === digits)
      .slice(0, 10)
      .map(toPatientDTO)
  })
}

async function clinicTimezone(tx: Prisma.TransactionClient, clinicId: string): Promise<string> {
  const clinic = await tx.clinic.findUniqueOrThrow({ where: { id: clinicId }, select: { timezone: true } })
  return clinic.timezone
}

/**
 * §7.2 walk-in registration: creates the Patient and their same-day
 * QueueEntry (source WALK_IN, status CHECKED_IN) together. No silent
 * auto-match here — the staff-driven duplicate check
 * (`searchPatientsByPhone`) happens as its own UI step before this is ever
 * called; a front desk user who's already searched and found no match is
 * deliberately creating a new record. §7.1's public-booking auto-match
 * logic is a separate flow, wired up in M3.
 */
export async function registerWalkIn(
  user: AbilitySubject,
  input: unknown
): Promise<{ patient: PatientDTO; queueEntry: QueueEntryDTO }> {
  if (isHoldingAdmin(user)) {
    throw new Error("Holding admins don't register walk-ins directly — pick a clinic first")
  }
  const clinicId = requireClinicId(user)
  const parsed = patientIntakeSchema.parse(input)

  return runWithRls(user, async (tx) => {
    const timezone = await clinicTimezone(tx, clinicId)
    const queueDate = todayAsQueueDate(timezone)

    const patient = await tx.patient.create({
      data: {
        clinicId,
        firstName: parsed.firstName,
        lastName: parsed.lastName,
        middleName: parsed.middleName || null,
        birthdate: parsed.birthdate,
        sex: parsed.sex,
        phone: parsed.phone,
        email: parsed.email || null,
        address: parsed.address,
        emergencyContactName: parsed.emergencyContactName,
        emergencyContactPhone: parsed.emergencyContactPhone,
        guardianName: parsed.guardianName || null,
        guardianPhone: parsed.guardianPhone || null,
        consentAt: new Date(),
        createdById: user.id,
      },
    })

    const queueNumber = await nextQueueNumber(tx, clinicId, queueDate)
    const queueEntry = await tx.queueEntry.create({
      data: {
        clinicId,
        patientId: patient.id,
        queueNumber,
        queueDate,
        status: "CHECKED_IN",
        priority: parsed.priority ? "PRIORITY" : "NORMAL",
        source: "WALK_IN",
        reasonForVisit: parsed.reasonForVisit,
        checkedInAt: new Date(),
        accessToken: generateAccessToken(),
      },
    })

    await tx.auditLog.create({
      data: { clinicId, userId: user.id, action: "patient.create", entityType: "Patient", entityId: patient.id },
    })
    await tx.auditLog.create({
      data: {
        clinicId,
        userId: user.id,
        action: "queue_entry.create",
        entityType: "QueueEntry",
        entityId: queueEntry.id,
        changes: { source: "WALK_IN", patientId: patient.id },
      },
    })

    return { patient: toPatientDTO(patient), queueEntry: toQueueEntryDTO(queueEntry) }
  })
}

/** Checks in a patient the front desk already found via `searchPatientsByPhone` — no new Patient row. */
export async function checkInExistingPatient(
  user: AbilitySubject,
  patientId: string,
  input: { reasonForVisit: string; priority: boolean }
): Promise<QueueEntryDTO> {
  if (isHoldingAdmin(user)) {
    throw new Error("Holding admins don't check in walk-ins directly — pick a clinic first")
  }
  const clinicId = requireClinicId(user)

  return runWithRls(user, async (tx) => {
    const patient = await tx.patient.findFirst({ where: { id: patientId, clinicId, deletedAt: null } })
    if (!patient) {
      throw new ForbiddenError("Patient not found in your clinic")
    }

    const timezone = await clinicTimezone(tx, clinicId)
    const queueDate = todayAsQueueDate(timezone)
    const queueNumber = await nextQueueNumber(tx, clinicId, queueDate)

    const queueEntry = await tx.queueEntry.create({
      data: {
        clinicId,
        patientId,
        queueNumber,
        queueDate,
        status: "CHECKED_IN",
        priority: input.priority ? "PRIORITY" : "NORMAL",
        source: "WALK_IN",
        reasonForVisit: input.reasonForVisit,
        checkedInAt: new Date(),
        accessToken: generateAccessToken(),
      },
    })

    await tx.auditLog.create({
      data: {
        clinicId,
        userId: user.id,
        action: "queue_entry.create",
        entityType: "QueueEntry",
        entityId: queueEntry.id,
        changes: { source: "WALK_IN", patientId },
      },
    })

    return toQueueEntryDTO(queueEntry)
  })
}

/** A patient's visit history for their profile screen — queue entries, newest first. */
export async function listPatientVisits(user: AbilitySubject, patientId: string): Promise<QueueEntryDTO[]> {
  return runWithRls(user, async (tx) => {
    const entries = await tx.queueEntry.findMany({
      where: isHoldingAdmin(user) ? { patientId } : { patientId, clinicId: user.clinicId! },
      orderBy: [{ queueDate: "desc" }, { queueNumber: "desc" }],
      take: 25,
    })
    return entries.map(toQueueEntryDTO)
  })
}
