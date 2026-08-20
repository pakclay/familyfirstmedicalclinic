import { describe, expect, it } from "vitest"
import { toPatientDTO, type PatientForDTO } from "../patient"

const BASE: PatientForDTO = {
  id: "p1",
  patientCode: "SLPH-SF-CT-00001",
  firstName: "Juan",
  lastName: "Dela Cruz",
  middleName: null,
  birthDate: new Date("1990-01-01"),
  sex: "MALE",
  mobile: "09171234567",
  email: null,
  address: "123 Rizal St.",
  city: "San Fernando",
  province: "Pampanga",
  occupation: null,
  sportOrActivity: null,
  referralSource: null,
  primaryTherapistId: null,
  status: "ACTIVE_PROGRAM",
  lastVisitAt: null,
  createdAt: new Date(),
  emergencyContactName: "Ana Dela Cruz",
  emergencyContactPhone: "09179876543",
  homeBranch: { name: "Test Branch" },
  consents: [],
  intakeSubmissions: [],
}

describe("toPatientDTO — the 'even nested' half of §4.2's hard rule", () => {
  it("never forwards money fields a careless query might have included", () => {
    // Simulates a future developer accidentally `include`-ing relations
    // that carry money — patientPackages (priceCentavos) and payments
    // (amountCentavos). The DTO must ignore them regardless.
    const withLeakedMoney = {
      ...BASE,
      patientPackages: [{ id: "pp1", priceCentavos: 500000 }],
      payments: [{ id: "pay1", amountCentavos: 150000 }],
    }

    const dto = toPatientDTO(withLeakedMoney)
    const serialized = JSON.stringify(dto)

    expect(dto).not.toHaveProperty("patientPackages")
    expect(dto).not.toHaveProperty("payments")
    expect(serialized).not.toMatch(/centavos/i)
  })

  it("still returns the demographic fields a legitimate viewer needs", () => {
    const dto = toPatientDTO(BASE)
    expect(dto.patientCode).toBe("SLPH-SF-CT-00001")
    expect(dto.firstName).toBe("Juan")
    expect(dto.homeBranch.name).toBe("Test Branch")
  })
})
