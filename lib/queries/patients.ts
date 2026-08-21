import { runWithRls } from "@/lib/db/rls"
import { isHoldingAdmin, type AbilitySubject } from "@/lib/permissions/ability"
import { ForbiddenError } from "@/lib/permissions/errors"
import { toPatientDTO, type PatientDTO } from "@/lib/dto/patient"

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
