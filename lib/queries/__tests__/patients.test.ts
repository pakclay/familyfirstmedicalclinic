import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { Role, Sex } from "@prisma/client"
import { superuserPrisma } from "@/lib/test/superuser-prisma"
import { prisma } from "@/lib/db/prisma"
import { getPatientById, listPatients } from "@/lib/queries/patients"
import { ForbiddenError } from "@/lib/permissions/errors"
import type { AbilitySubject } from "@/lib/permissions/ability"

/**
 * M1's explicit acceptance bar (§12): "a staff user of Clinic A receives a
 * 403 attempting to open a Clinic B patient by direct URL, and the attempt
 * appears in the audit log." Covers both layers independently — the
 * application-layer check in getPatientById, and the Postgres RLS backstop
 * (enable_rls_backstop migration) even if that check were bypassed.
 */
describe("clinic scoping — patients", () => {
  let clinicA: { id: string }
  let clinicB: { id: string }
  let frontDeskA: AbilitySubject
  let holdingAdmin: AbilitySubject
  let patientA: { id: string }
  let patientB: { id: string }

  beforeAll(async () => {
    const holding = await superuserPrisma.holdingCompany.create({
      data: { name: "Test Holding" },
    })

    clinicA = await superuserPrisma.clinic.create({
      data: {
        holdingCompanyId: holding.id,
        name: "Clinic A",
        slug: `clinic-a-${Date.now()}`,
        address: "1 Test St",
        city: "Test City",
        phone: "0000",
        operatingHours: {},
      },
    })
    clinicB = await superuserPrisma.clinic.create({
      data: {
        holdingCompanyId: holding.id,
        name: "Clinic B",
        slug: `clinic-b-${Date.now()}`,
        address: "2 Test St",
        city: "Test City",
        phone: "0000",
        operatingHours: {},
      },
    })

    const userA = await superuserPrisma.user.create({
      data: {
        clinicId: clinicA.id,
        name: "Front Desk A",
        email: `frontdesk-a-${Date.now()}@test.local`,
        passwordHash: "unused",
        role: Role.FRONT_DESK,
      },
    })
    const userHolding = await superuserPrisma.user.create({
      data: {
        holdingCompanyId: holding.id,
        name: "Holding Admin",
        email: `holding-${Date.now()}@test.local`,
        passwordHash: "unused",
        role: Role.HOLDING_ADMIN,
      },
    })

    frontDeskA = { id: userA.id, role: Role.FRONT_DESK, clinicId: clinicA.id, holdingCompanyId: null }
    holdingAdmin = { id: userHolding.id, role: Role.HOLDING_ADMIN, clinicId: null, holdingCompanyId: holding.id }

    patientA = await superuserPrisma.patient.create({
      data: {
        clinicId: clinicA.id,
        firstName: "Alice",
        lastName: "InClinicA",
        birthdate: new Date("1990-01-01"),
        sex: Sex.FEMALE,
        phone: "111",
        address: "addr",
        emergencyContactName: "ec",
        emergencyContactPhone: "222",
      },
    })
    patientB = await superuserPrisma.patient.create({
      data: {
        clinicId: clinicB.id,
        firstName: "Bob",
        lastName: "InClinicB",
        birthdate: new Date("1985-05-05"),
        sex: Sex.MALE,
        phone: "333",
        address: "addr",
        emergencyContactName: "ec",
        emergencyContactPhone: "444",
      },
    })
  })

  afterAll(async () => {
    await superuserPrisma.auditLog.deleteMany({ where: { clinicId: { in: [clinicA.id, clinicB.id] } } })
    await superuserPrisma.patient.deleteMany({ where: { clinicId: { in: [clinicA.id, clinicB.id] } } })
    await superuserPrisma.user.deleteMany({ where: { clinicId: { in: [clinicA.id, clinicB.id] } } })
    await superuserPrisma.user.delete({ where: { id: holdingAdmin.id } })
    await superuserPrisma.clinic.deleteMany({ where: { id: { in: [clinicA.id, clinicB.id] } } })
    await superuserPrisma.holdingCompany.deleteMany({ where: { name: "Test Holding" } })
    await superuserPrisma.$disconnect()
    await prisma.$disconnect()
  })

  it("lets a front desk user read a patient in their own clinic, and audit-logs it", async () => {
    const result = await getPatientById(frontDeskA, patientA.id)
    expect(result?.id).toBe(patientA.id)

    const log = await superuserPrisma.auditLog.findFirst({
      where: { entityId: patientA.id, action: "patient.read", userId: frontDeskA.id },
    })
    expect(log).toBeTruthy()
  })

  it("403s a front desk user reading another clinic's patient by direct id, and audit-logs the attempt", async () => {
    await expect(getPatientById(frontDeskA, patientB.id)).rejects.toBeInstanceOf(ForbiddenError)

    const log = await superuserPrisma.auditLog.findFirst({
      where: { entityId: patientB.id, action: "patient.read.denied", userId: frontDeskA.id },
    })
    expect(log).toBeTruthy()
    expect((log?.changes as { attemptedClinicId?: string } | null)?.attemptedClinicId).toBe(clinicB.id)
  })

  it("returns null (not forbidden) for an id that doesn't exist anywhere", async () => {
    const result = await getPatientById(frontDeskA, "00000000-0000-0000-0000-000000000000")
    expect(result).toBeNull()
  })

  it("lets a holding admin read a patient in any clinic", async () => {
    const result = await getPatientById(holdingAdmin, patientB.id)
    expect(result?.id).toBe(patientB.id)
  })

  it("scopes listPatients to the caller's own clinic", async () => {
    const results = await listPatients(frontDeskA)
    expect(results.map((p) => p.id)).toContain(patientA.id)
    expect(results.map((p) => p.id)).not.toContain(patientB.id)
  })

  it("RLS backstop: an unfiltered raw query under Clinic A's session context cannot see Clinic B's patient, independent of the app-layer check", async () => {
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.role', ${Role.FRONT_DESK}, true)`
      await tx.$executeRaw`SELECT set_config('app.user_id', ${frontDeskA.id}, true)`
      await tx.$executeRaw`SELECT set_config('app.clinic_id', ${clinicA.id}, true)`
      // deliberately unfiltered — proves the DB itself hides the row, not just the app query's WHERE clause
      return tx.patient.findMany({ where: { id: patientB.id } })
    })
    expect(rows).toHaveLength(0)
  })
})
