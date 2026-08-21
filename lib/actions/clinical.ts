"use server"

import { requireSession } from "@/lib/auth/guards"
import {
  createAssessmentFor,
  listAssessmentsForPatient,
  listDoctorQueueFor,
  createPrescriptionFor,
  signPrescriptionFor,
  listPrescriptionsForPatient,
  createCarePlanFor,
  listCarePlansForPatient,
} from "@/lib/queries/clinical"
import type { AssessmentInput, PrescriptionInput, CarePlanInput } from "@/lib/validation/clinical"

export async function createAssessment(input: AssessmentInput & { patientId: string; branchId: string }) {
  const user = await requireSession()
  return createAssessmentFor(user, input)
}

export async function listAssessments(patientId: string) {
  const user = await requireSession()
  return listAssessmentsForPatient(user, patientId)
}

export async function listDoctorQueue() {
  const user = await requireSession()
  return listDoctorQueueFor(user)
}

export async function createPrescription(input: PrescriptionInput & { patientId: string; assessmentId: string }) {
  const user = await requireSession()
  return createPrescriptionFor(user, input)
}

export async function signPrescription(prescriptionId: string) {
  const user = await requireSession()
  return signPrescriptionFor(user, prescriptionId)
}

export async function listPrescriptions(patientId: string) {
  const user = await requireSession()
  return listPrescriptionsForPatient(user, patientId)
}

export async function createCarePlan(
  input: CarePlanInput & { patientId: string; track: "WELLNESS" | "REHAB"; prescriptionId?: string }
) {
  const user = await requireSession()
  return createCarePlanFor(user, input)
}

export async function listCarePlans(patientId: string) {
  const user = await requireSession()
  return listCarePlansForPatient(user, patientId)
}
