import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { prisma } from "@/lib/db/prisma"
import { runWithRls } from "@/lib/db/rls"
import { superuserPrisma } from "@/lib/test/superuser-prisma"
import { listPatientsFor, getPatientFor, createPatientRecordFor, type CreatePatientInput } from "../patients"
import { ForbiddenError } from "@/lib/permissions/errors"
import type { AbilitySubject } from "@/lib/permissions/ability"

// Integration tests against the real dev Postgres — RLS is a DB-level
// feature, so unlike ability.test.ts's pure unit tests, these need a real
// connection (via APP_DATABASE_URL, the non-superuser role) to mean
// anything. See DECISIONS.md.

const owner: AbilitySubject = { role: "OWNER", id: "test-owner", homeBranchId: null }

let branchA: { id: string }
let branchB: { id: string }

function subject(role: AbilitySubject["role"], id: string, homeBranchId: string | null): AbilitySubject {
  return { role, id, homeBranchId }
}

function baseIntake(overrides: Partial<CreatePatientInput> = {}): CreatePatientInput {
  return {
    firstName: "Test",
    lastName: "Patient",
    birthDate: "1990-01-01",
    sex: "MALE",
    mobile: "09171234567",
    address: "1 Test St.",
    city: "San Fernando",
    province: "Pampanga",
    emergencyContactName: "Emergency Contact",
    emergencyContactPhone: "09179876543",
    consentTreatment: true,
    consentDataPrivacy: true,
    consentMarketing: false,
    consentPhoto: false,
    homeBranchId: branchA.id,
    ...overrides,
  }
}

beforeAll(async () => {
  branchA = await prisma.branch.upsert({
    where: { code: "TEST-P2-A" },
    update: {},
    create: {
      code: "TEST-P2-A",
      name: "Phase 2 Test Branch A",
      address: "",
      city: "",
      province: "",
      phone: "",
      openingHours: {},
    },
  })
  branchB = await prisma.branch.upsert({
    where: { code: "TEST-P2-B" },
    update: {},
    create: {
      code: "TEST-P2-B",
      name: "Phase 2 Test Branch B",
      address: "",
      city: "",
      province: "",
      phone: "",
      openingHours: {},
    },
  })
})

afterAll(async () => {
  // DELETE has no RLS policy at all (see superuser-prisma.ts) — teardown
  // needs the privileged connection, not runWithRls.
  await superuserPrisma.patientConsent.deleteMany({
    where: { patient: { homeBranchId: { in: [branchA.id, branchB.id] } } },
  })
  await superuserPrisma.patient.deleteMany({ where: { homeBranchId: { in: [branchA.id, branchB.id] } } })
  await superuserPrisma.branch.deleteMany({ where: { id: { in: [branchA.id, branchB.id] } } })
  await superuserPrisma.$disconnect()
  await prisma.$disconnect()
})

describe("forbidden access is loud, not an empty list", () => {
  it("MARKETING listing patients throws ForbiddenError", async () => {
    await expect(listPatientsFor(subject("MARKETING", "m1", null), {})).rejects.toThrow(ForbiddenError)
  })

  it("MARKETING reading a specific patient throws ForbiddenError", async () => {
    await expect(getPatientFor(subject("MARKETING", "m1", null), "whatever-id")).rejects.toThrow(ForbiddenError)
  })

  it("MARKETING creating a patient throws ForbiddenError", async () => {
    await expect(createPatientRecordFor(subject("MARKETING", "m1", null), baseIntake())).rejects.toThrow(ForbiddenError)
  })

  it("DOCTOR (read-only on patients) creating a patient throws ForbiddenError", async () => {
    await expect(createPatientRecordFor(subject("DOCTOR", "d1", branchA.id), baseIntake())).rejects.toThrow(
      ForbiddenError
    )
  })

  it("FRONT_DESK creating a patient in another branch throws ForbiddenError", async () => {
    const frontDeskAtB = subject("FRONT_DESK", "fd1", branchB.id)
    await expect(createPatientRecordFor(frontDeskAtB, baseIntake({ homeBranchId: branchA.id }))).rejects.toThrow(
      ForbiddenError
    )
  })
})

describe("branch scoping is enforced, not just documented", () => {
  it("BRANCH_MANAGER only ever sees their own branch's patients", async () => {
    const patientA = await createPatientRecordFor(owner, baseIntake({ mobile: "09170000001", homeBranchId: branchA.id }))
    const patientB = await createPatientRecordFor(owner, baseIntake({ mobile: "09170000002", homeBranchId: branchB.id }))

    const managerA = subject("BRANCH_MANAGER", "mgrA", branchA.id)
    const listForA = await listPatientsFor(managerA, {})
    expect(listForA.some((p) => p.id === patientA.id)).toBe(true)
    expect(listForA.some((p) => p.id === patientB.id)).toBe(false)

    const crossBranchRead = await getPatientFor(managerA, patientB.id)
    expect(crossBranchRead).toBeNull()
  })
})

describe("RLS backstop denies even when the app-layer where clause is missing", () => {
  it("a raw unfiltered query as THERAPIST only returns their own patients", async () => {
    const patient = await createPatientRecordFor(owner, baseIntake({ mobile: "09170000003" }))
    const therapistId = "test-therapist-rls"
    await runWithRls(owner, (tx) => tx.patient.update({ where: { id: patient.id }, data: { primaryTherapistId: therapistId } }))

    const therapist = subject("THERAPIST", therapistId, null)
    // Deliberately no `where` at all — this is the exact bug the RLS
    // backstop exists for: if the app layer ever forgets to scope a query,
    // Postgres itself still won't hand back another therapist's patients.
    const rows = await runWithRls(therapist, (tx) => tx.patient.findMany({}))
    expect(rows.every((r) => r.primaryTherapistId === therapistId)).toBe(true)
    expect(rows.some((r) => r.id === patient.id)).toBe(true)
  })

  it("a raw unfiltered query as MARKETING returns zero patient rows", async () => {
    const rows = await runWithRls(subject("MARKETING", "m1", null), (tx) => tx.patient.findMany({}))
    expect(rows).toHaveLength(0)
  })
})
