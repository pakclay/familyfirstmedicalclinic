import type { Patient } from "@prisma/client"
import { ageInYears } from "@/lib/utils/age"

/**
 * Explicit field allowlist, not a redaction function — every field here is
 * safe for any role that can read a Patient at all (clinic scoping is
 * enforced before this ever runs). Age is derived here rather than stored
 * (§6: "never store age").
 */
export type PatientDTO = {
  id: string
  branchId: string
  firstName: string
  lastName: string
  middleName: string | null
  birthdate: Date
  age: number
  isMinor: boolean
  sex: "MALE" | "FEMALE"
  phone: string
  email: string | null
  address: string
  emergencyContactName: string
  emergencyContactPhone: string
  guardianName: string | null
  guardianPhone: string | null
  notes: string | null
  createdAt: Date
}

export function toPatientDTO(patient: Patient): PatientDTO {
  const age = ageInYears(patient.birthdate)
  return {
    id: patient.id,
    branchId: patient.branchId,
    firstName: patient.firstName,
    lastName: patient.lastName,
    middleName: patient.middleName,
    birthdate: patient.birthdate,
    age,
    isMinor: age < 18,
    sex: patient.sex,
    phone: patient.phone,
    email: patient.email,
    address: patient.address,
    emergencyContactName: patient.emergencyContactName,
    emergencyContactPhone: patient.emergencyContactPhone,
    guardianName: patient.guardianName,
    guardianPhone: patient.guardianPhone,
    notes: patient.notes,
    createdAt: patient.createdAt,
  }
}
