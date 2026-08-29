"use server"

import { auth } from "@/auth"
import { ForbiddenError } from "@/lib/permissions/errors"
import type { AbilitySubject } from "@/lib/permissions/ability"
import {
  searchPatientsByPhone,
  registerWalkIn,
  checkInExistingPatient,
  getPatientById,
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
    holdingCompanyId: session.user.holdingCompanyId,
  }
}

export async function searchByPhoneAction(phone: string): Promise<PatientDTO[]> {
  const user = await actingUser()
  return searchPatientsByPhone(user, phone)
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

export async function checkInExistingAction(
  patientId: string,
  reasonForVisit: string,
  priority: boolean
): Promise<{ patient: PatientDTO | null; queueEntry: QueueEntryDTO }> {
  const user = await actingUser()
  const queueEntry = await checkInExistingPatient(user, patientId, { reasonForVisit, priority })
  const patient = await getPatientById(user, patientId)
  return { patient, queueEntry }
}
