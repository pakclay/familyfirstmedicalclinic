import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { Role } from "@prisma/client"
import { superuserPrisma } from "@/lib/test/superuser-prisma"
import { prisma } from "@/lib/db/prisma"
import {
  registerWalkIn,
  checkInExistingPatient,
  searchPatientsByPhone,
  searchPatientsForIntake,
} from "@/lib/queries/patients"
import { ForbiddenError } from "@/lib/permissions/errors"
import type { AbilitySubject } from "@/lib/permissions/ability"
import type { PatientIntakeInput } from "@/lib/validation/patient"

/**
 * M2's accept bar (§12): "front desk registers a walk-in in under 60
 * seconds, and searching an existing patient by phone surfaces their
 * prior visits." Covers §7.2's whole flow — duplicate-avoiding phone
 * search, new-patient registration with same-day queue check-in, and
 * checking in a patient the search already found.
 */
describe("walk-in registration", () => {
  let clinicIdA: string
  let clinicIdB: string
  let branchA: { id: string }
  let branchB: { id: string }
  let frontDeskA: AbilitySubject
  let frontDeskB: AbilitySubject

  const basePatient: Omit<PatientIntakeInput, "birthdate"> & { birthdate: string } = {
    firstName: "Juan",
    lastName: "Dela Cruz",
    middleName: "",
    birthdate: "1990-06-15",
    sex: "MALE",
    phone: "+63 917 555 0001",
    email: "",
    address: "1 Rizal St.",
    emergencyContactName: "Maria Dela Cruz",
    emergencyContactPhone: "+63 917 555 0002",
    guardianName: "",
    guardianPhone: "",
    reasonForVisit: "Fever",
    priority: false,
    consent: true,
  }

  beforeAll(async () => {
    const holding = await superuserPrisma.holdingCompany.create({ data: { name: "Reg Test Holding" } })
    const clinicA = await superuserPrisma.clinic.create({ data: { holdingCompanyId: holding.id, name: "Reg Clinic A" } })
    const clinicB = await superuserPrisma.clinic.create({ data: { holdingCompanyId: holding.id, name: "Reg Clinic B" } })
    clinicIdA = clinicA.id
    clinicIdB = clinicB.id
    branchA = await superuserPrisma.branch.create({
      data: {
        clinicId: clinicA.id,
        name: "Reg Branch A",
        slug: `reg-branch-a-${Date.now()}`,
        address: "1 Test St",
        city: "Test City",
        phone: "0000",
        timezone: "Asia/Manila",
        operatingHours: {},
      },
    })
    branchB = await superuserPrisma.branch.create({
      data: {
        clinicId: clinicB.id,
        name: "Reg Branch B",
        slug: `reg-branch-b-${Date.now()}`,
        address: "2 Test St",
        city: "Test City",
        phone: "0000",
        timezone: "Asia/Manila",
        operatingHours: {},
      },
    })
    const userA = await superuserPrisma.user.create({
      data: {
        branchId: branchA.id,
        name: "Front Desk A",
        email: `fd-a-${Date.now()}@test.local`,
        passwordHash: "unused",
        role: Role.FRONT_DESK,
      },
    })
    const userB = await superuserPrisma.user.create({
      data: {
        branchId: branchB.id,
        name: "Front Desk B",
        email: `fd-b-${Date.now()}@test.local`,
        passwordHash: "unused",
        role: Role.FRONT_DESK,
      },
    })
    frontDeskA = { id: userA.id, role: Role.FRONT_DESK, branchId: branchA.id, holdingCompanyId: null }
    frontDeskB = { id: userB.id, role: Role.FRONT_DESK, branchId: branchB.id, holdingCompanyId: null }
  })

  afterAll(async () => {
    await superuserPrisma.auditLog.deleteMany({ where: { branchId: { in: [branchA.id, branchB.id] } } })
    await superuserPrisma.queueEntry.deleteMany({ where: { branchId: { in: [branchA.id, branchB.id] } } })
    await superuserPrisma.patient.deleteMany({ where: { branchId: { in: [branchA.id, branchB.id] } } })
    await superuserPrisma.user.deleteMany({ where: { branchId: { in: [branchA.id, branchB.id] } } })
    await superuserPrisma.branch.deleteMany({ where: { id: { in: [branchA.id, branchB.id] } } })
    await superuserPrisma.clinic.deleteMany({ where: { id: { in: [clinicIdA, clinicIdB] } } })
    await superuserPrisma.holdingCompany.deleteMany({ where: { name: "Reg Test Holding" } })
    await superuserPrisma.$disconnect()
    await prisma.$disconnect()
  })

  it("registers a new patient and checks them in with queue number 1", async () => {
    const { patient, queueEntry } = await registerWalkIn(frontDeskA, basePatient)
    expect(patient.branchId).toBe(branchA.id)
    expect(patient.firstName).toBe("Juan")
    expect(queueEntry.queueNumber).toBe(1)
    expect(queueEntry.status).toBe("CHECKED_IN")
    expect(queueEntry.source).toBe("WALK_IN")
    expect(queueEntry.priority).toBe("NORMAL")

    const log = await superuserPrisma.auditLog.findFirst({
      where: { entityId: patient.id, action: "patient.create" },
    })
    expect(log).toBeTruthy()
  })

  it("assigns sequential queue numbers within the same branch/day", async () => {
    const { queueEntry: second } = await registerWalkIn(frontDeskA, {
      ...basePatient,
      firstName: "Pedro",
      phone: "+63 917 555 0099",
    })
    expect(second.queueNumber).toBe(2)
  })

  it("rejects a minor with no guardian info", async () => {
    await expect(
      registerWalkIn(frontDeskA, { ...basePatient, phone: "+63 917 555 0003", birthdate: "2018-01-01" })
    ).rejects.toThrow()
  })

  it("accepts a minor with guardian info", async () => {
    const { patient } = await registerWalkIn(frontDeskA, {
      ...basePatient,
      firstName: "Baby",
      phone: "+63 917 555 0004",
      birthdate: "2018-01-01",
      guardianName: "Ana Santos",
      guardianPhone: "+63 917 555 0005",
    })
    expect(patient.isMinor).toBe(true)
  })

  it("finds an existing patient by phone regardless of formatting, scoped to the searcher's branch", async () => {
    const found = await searchPatientsByPhone(frontDeskA, "09175550001")
    expect(found.map((p) => p.firstName)).toContain("Juan")

    const foundFromOtherBranch = await searchPatientsByPhone(frontDeskB, "09175550001")
    expect(foundFromOtherBranch).toHaveLength(0)
  })

  it("checks in an existing patient without creating a duplicate Patient row", async () => {
    const [existing] = await searchPatientsByPhone(frontDeskA, "09175550001")
    const patientsBefore = await superuserPrisma.patient.count({ where: { branchId: branchA.id } })

    const queueEntry = await checkInExistingPatient(frontDeskA, existing.id, {
      reasonForVisit: "Follow-up",
      priority: true,
    })

    const patientsAfter = await superuserPrisma.patient.count({ where: { branchId: branchA.id } })
    expect(patientsAfter).toBe(patientsBefore)
    expect(queueEntry.priority).toBe("PRIORITY")
    expect(queueEntry.reasonForVisit).toBe("Follow-up")
  })

  it("won't check in a patient that belongs to a different branch", async () => {
    const [patientInA] = await searchPatientsByPhone(frontDeskA, "09175550001")
    await expect(
      checkInExistingPatient(frontDeskB, patientInA.id, { reasonForVisit: "x", priority: false })
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  /**
   * The intake search is what stands between the front desk and a duplicate
   * record. searchPatientsByPhone above only ever matched an exact number, so
   * a mistyped or changed one left re-encoding as the desk's only option —
   * these cover the ways a returning patient is actually identified at a
   * counter.
   */
  describe("searchPatientsForIntake", () => {
    const names = async (subject: AbilitySubject, term: string) =>
      (await searchPatientsForIntake(subject, term)).map((p) => p.firstName)

    it("finds a patient by last name", async () => {
      expect(await names(frontDeskA, "Dela Cruz")).toContain("Juan")
    })

    it("finds a patient by first name, case-insensitively", async () => {
      expect(await names(frontDeskA, "juan")).toContain("Juan")
    })

    it("finds a patient by a partial name", async () => {
      expect(await names(frontDeskA, "cruz")).toContain("Juan")
    })

    it("finds a patient by full name in either order", async () => {
      expect(await names(frontDeskA, "Juan Dela Cruz")).toContain("Juan")
      // The order the app itself displays names in, comma and all — a desk
      // user reading it off another screen types exactly this.
      expect(await names(frontDeskA, "Dela Cruz, Juan")).toContain("Juan")
    })

    it("still finds a patient by phone regardless of formatting", async () => {
      expect(await names(frontDeskA, "09175550001")).toContain("Juan")
      expect(await names(frontDeskA, "+63 917 555 0001")).toContain("Juan")
    })

    it("returns nothing for a term too short to narrow anything", async () => {
      expect(await searchPatientsForIntake(frontDeskA, "j")).toEqual([])
      expect(await searchPatientsForIntake(frontDeskA, "  ")).toEqual([])
    })

    it("is scoped to the searcher's own branch", async () => {
      // Positive control first: the patient is findable, so the empty result
      // below is a branch boundary rather than a search that finds nobody.
      expect(await names(frontDeskA, "Dela Cruz")).toContain("Juan")
      expect(await searchPatientsForIntake(frontDeskB, "Dela Cruz")).toEqual([])
      expect(await searchPatientsForIntake(frontDeskB, "09175550001")).toEqual([])
    })
  })
})
