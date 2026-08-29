import { runWithRls } from "@/lib/db/rls"
import { requireBranchId, type AbilitySubject } from "@/lib/permissions/ability"
import { ForbiddenError } from "@/lib/permissions/errors"
import { vitalsSchema, toStoredVitals, isEmptyVitals } from "@/lib/validation/vitals"
import type { Prisma } from "@prisma/client"

/**
 * Recording triage vitals against a visit.
 *
 * Vitals already existed on `consultations`, but only a doctor could ever
 * write them — a Consultation row requires a doctor and is created by
 * saveConsultation, which happens after the patient has been seen. Vitals
 * are taken before that, usually by whoever checks the patient in, so there
 * was no write path for the people who actually measure them.
 *
 * Stored on the queue entry, which is branch-scoped and RLS-protected
 * already, so these inherit the same isolation as the rest of the visit
 * without a new policy to get wrong.
 */

export type VitalsDTO = {
  queueEntryId: string
  vitals: Record<string, string>
  recordedAt: Date | null
  recordedByName: string | null
}

export type RecordVitalsResult = { ok: true; vitals: VitalsDTO } | { ok: false; error: string }

/**
 * Anyone physically present with the patient. §4 puts front desk on
 * check-in and doctors in the consultation room; a clinic admin covers the
 * desk in practice. A holding admin is excluded deliberately — they have no
 * branch, so requireBranchId below would throw anyway, and someone
 * administering the company from elsewhere has no business entering a
 * clinical measurement they did not take.
 */
const CAN_RECORD_VITALS = ["FRONT_DESK", "DOCTOR", "CLINIC_ADMIN"] as const

function vitalsInclude() {
  return { vitalsRecordedBy: { select: { name: true } } } satisfies Prisma.QueueEntryInclude
}

function toVitalsDTO(entry: {
  id: string
  vitals: Prisma.JsonValue
  vitalsRecordedAt: Date | null
  vitalsRecordedBy: { name: string } | null
}): VitalsDTO {
  return {
    queueEntryId: entry.id,
    // The column is free-form JSON, so a row written before this schema
    // existed could be any shape. Anything that is not an object of strings
    // is treated as absent rather than trusted into the UI.
    vitals:
      entry.vitals && typeof entry.vitals === "object" && !Array.isArray(entry.vitals)
        ? Object.fromEntries(
            Object.entries(entry.vitals as Record<string, unknown>)
              .filter(([, v]) => typeof v === "string" && v !== "")
              .map(([k, v]) => [k, v as string])
          )
        : {},
    recordedAt: entry.vitalsRecordedAt,
    recordedByName: entry.vitalsRecordedBy?.name ?? null,
  }
}

export async function recordVitals(
  user: AbilitySubject,
  queueEntryId: string,
  input: unknown
): Promise<RecordVitalsResult> {
  if (!CAN_RECORD_VITALS.includes(user.role as (typeof CAN_RECORD_VITALS)[number])) {
    return { ok: false, error: "Only clinic staff can record vitals." }
  }

  const parsed = vitalsSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the vitals for errors." }
  }
  // Refused rather than written as `{}`: an empty save would stamp
  // recordedAt and a recorder's name onto a reading that does not exist,
  // which reads in the UI as "vitals were taken" and is worse than blank.
  if (isEmptyVitals(parsed.data)) {
    return { ok: false, error: "Enter at least one measurement." }
  }

  const branchId = requireBranchId(user)

  const updated = await runWithRls(user, async (tx) => {
    // Scoped find before the write, the same choke point every other
    // queue-entry mutation goes through — the branch predicate is on the
    // read, so a foreign entry is refused rather than updated.
    const entry = await tx.queueEntry.findFirst({ where: { id: queueEntryId, branchId } })
    if (!entry) throw new ForbiddenError("Queue entry not found in your branch")

    const row = await tx.queueEntry.update({
      where: { id: queueEntryId },
      data: {
        vitals: toStoredVitals(parsed.data),
        vitalsRecordedAt: new Date(),
        vitalsRecordedById: user.id,
      },
      include: vitalsInclude(),
    })

    // The measurements themselves are clinical data and belong on the
    // visit, not duplicated into an audit row that a different set of
    // people can read. What is audited is that someone recorded them.
    await tx.auditLog.create({
      data: {
        branchId,
        userId: user.id,
        action: "queue_entry.vitals_recorded",
        entityType: "QueueEntry",
        entityId: queueEntryId,
        changes: { fields: Object.keys(toStoredVitals(parsed.data)).sort() },
      },
    })

    return row
  })

  return { ok: true, vitals: toVitalsDTO(updated) }
}

/** Read-back for the consultation screen, so a doctor sees what triage measured. */
export async function getVitals(user: AbilitySubject, queueEntryId: string): Promise<VitalsDTO> {
  const branchId = requireBranchId(user)
  return runWithRls(user, async (tx) => {
    const entry = await tx.queueEntry.findFirst({
      where: { id: queueEntryId, branchId },
      include: vitalsInclude(),
    })
    if (!entry) throw new ForbiddenError("Queue entry not found in your branch")
    return toVitalsDTO(entry)
  })
}
