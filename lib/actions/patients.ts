"use server"

import type { PatientStatus } from "@prisma/client"
import { requireSession } from "@/lib/auth/guards"
import { listPatientsFor, getPatientFor, createPatientRecordFor, type CreatePatientInput } from "@/lib/queries/patients"

export type { CreatePatientInput } from "@/lib/queries/patients"
export type PatientListItem = Awaited<ReturnType<typeof listPatients>>[number]

export async function listPatients(query: { search?: string; status?: PatientStatus }) {
  const user = await requireSession()
  return listPatientsFor(user, query)
}

export async function getPatient(id: string) {
  const user = await requireSession()
  return getPatientFor(user, id)
}

export async function createPatientFromIntake(input: CreatePatientInput) {
  const user = await requireSession()
  return createPatientRecordFor(user, input)
}
