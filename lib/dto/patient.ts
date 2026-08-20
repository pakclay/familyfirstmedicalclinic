/**
 * Explicit-allowlist DTO for Patient. This is the "even nested" half of
 * the §4.2 hard rule: money never leaves through a Patient response no
 * matter what a future query accidentally `include`s (patientPackages,
 * payments — both carry centavos fields). Serializing through this
 * function instead of returning a raw Prisma object is what makes that
 * guarantee hold regardless of what the query fetched.
 */

export type PatientForDTO = {
  id: string
  patientCode: string
  firstName: string
  lastName: string
  middleName: string | null
  birthDate: Date
  sex: "MALE" | "FEMALE"
  mobile: string
  email: string | null
  address: string
  city: string
  province: string
  occupation: string | null
  sportOrActivity: string | null
  referralSource: string | null
  primaryTherapistId: string | null
  status: string
  lastVisitAt: Date | null
  createdAt: Date
  emergencyContactName: string
  emergencyContactPhone: string
  homeBranchId: string
  homeBranch: { name: string }
  consents: Array<{
    id: string
    consentType: string
    granted: boolean
    grantedAt: Date
  }>
  intakeSubmissions: Array<{
    id: string
    submittedAt: Date
    submittedVia: string
  }>
  // Deliberately not part of the input type — see the "even nested" test.
  // If a future query starts `include`-ing these, TypeScript won't stop
  // it, but toPatientDTO() below will still never read or forward them.
  [key: string]: unknown
}

export type PatientDTO = ReturnType<typeof toPatientDTO>

export function toPatientDTO(patient: PatientForDTO) {
  return {
    id: patient.id,
    patientCode: patient.patientCode,
    firstName: patient.firstName,
    lastName: patient.lastName,
    middleName: patient.middleName,
    birthDate: patient.birthDate,
    sex: patient.sex,
    mobile: patient.mobile,
    email: patient.email,
    address: patient.address,
    city: patient.city,
    province: patient.province,
    occupation: patient.occupation,
    sportOrActivity: patient.sportOrActivity,
    referralSource: patient.referralSource,
    primaryTherapistId: patient.primaryTherapistId,
    status: patient.status,
    lastVisitAt: patient.lastVisitAt,
    createdAt: patient.createdAt,
    emergencyContactName: patient.emergencyContactName,
    emergencyContactPhone: patient.emergencyContactPhone,
    homeBranchId: patient.homeBranchId,
    homeBranch: { name: patient.homeBranch.name },
    consents: patient.consents.map((c) => ({
      id: c.id,
      consentType: c.consentType,
      granted: c.granted,
      grantedAt: c.grantedAt,
    })),
    intakeSubmissions: patient.intakeSubmissions.map((s) => ({
      id: s.id,
      submittedAt: s.submittedAt,
      submittedVia: s.submittedVia,
    })),
  }
}
