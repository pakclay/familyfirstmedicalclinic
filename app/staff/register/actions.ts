"use server"

import { auth } from "@/auth"
import { ForbiddenError } from "@/lib/permissions/errors"
import type { AbilitySubject } from "@/lib/permissions/ability"
import {
  searchPatientsForIntake,
  registerWalkIn,
  checkInExistingPatient,
  getPatientById,
  PatientAlreadyQueuedError,
} from "@/lib/queries/patients"
import { patientIntakeSchema } from "@/lib/validation/patient"
import type { PatientDTO } from "@/lib/dto/patient"
import type { QueueEntryDTO } from "@/lib/dto/queue-entry"

async function actingUser(): Promise<AbilitySubject> {
  const session = await auth()
  if (!session?.user) throw new ForbiddenError("Not signed in")
  return {
    id: session.user.id,
    role: session.user.role,
    branchId: session.user.branchId,
    clinicId: session.user.clinicId,
    holdingCompanyId: session.user.holdingCompanyId,
  }
}

/**
 * The desk's lookup: one term matched against names and phone numbers alike.
 * Distinct from searchPatientsByPhone, which stays exact-match on the number
 * because the booking auto-match needs certainty rather than candidates.
 */
export async function searchPatientsAction(term: string): Promise<PatientDTO[]> {
  const user = await actingUser()
  return searchPatientsForIntake(user, term)
}

export type RegisterResult = { patient: PatientDTO; queueEntry: QueueEntryDTO }

export async function registerNewPatientAction(
  formData: Record<string, unknown>
): Promise<{ ok: true; result: RegisterResult } | { ok: false; error: string }> {
  const user = await actingUser()
  const parsed = patientIntakeSchema.safeParse(formData)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form for errors." }
  }
  const result = await registerWalkIn(user, parsed.data)
  return { ok: true, result }
}

export type CheckInResult =
  | { ok: true; patient: PatientDTO | null; queueEntry: QueueEntryDTO }
  | { ok: false; error: string }

/**
 * A result rather than a throw for the one failure the desk can act on —
 * the patient already holds a place in today's queue — because a thrown
 * server-action error reaches the browser with its message stripped in
 * production. Anything else still throws to the flow's generic handler.
 */
export async function checkInExistingAction(
  patientId: string,
  reasonForVisit: string,
  priority: boolean
): Promise<CheckInResult> {
  const user = await actingUser()
  try {
    const queueEntry = await checkInExistingPatient(user, patientId, { reasonForVisit, priority })
    const patient = await getPatientById(user, patientId)
    return { ok: true, patient, queueEntry }
  } catch (err) {
    if (err instanceof PatientAlreadyQueuedError) return { ok: false, error: err.message }
    throw err
  }
}
