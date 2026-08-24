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
 * appears in the audit log." Now a branch-scoping bar (branches are the
 * operational unit — see DECISIONS.md), covering both layers independently
 * — the application-layer check in getPatientById, and the Postgres RLS
 * backstop (enable_rls_backstop/branch_rewrite_rls_policies migrations)
 * even if that check were bypassed.
 */
describe("branch scoping — patients", () => {
  let branchA: { id: string }
  let branchB: { id: string }
  let siblingOfA: { id: string }
  let frontDeskA: AbilitySubject
  let holdingAdmin: AbilitySubject
  let patientA: { id: string }
  let patientB: { id: string }
  let patientInSibling: { id: string }

  beforeAll(async () => {
    const holding = await superuserPrisma.holdingCompany.create({
      data: { name: "Test Holding" },
    })
    const clinicA = await superuserPrisma.clinic.create({ data: { holdingCompanyId: holding.id, name: "Clinic A" } })
    const clinicB = await superuserPrisma.clinic.create({ data: { holdingCompanyId: holding.id, name: "Clinic B" } })

    branchA = await superuserPrisma.branch.create({
      data: {
        clinicId: clinicA.id,
        name: "Branch A",
        slug: `branch-a-${Date.now()}`,
        address: "1 Test St",
        city: "Test City",
        phone: "0000",
        operatingHours: {},
      },
    })
    branchB = await superuserPrisma.branch.create({
      data: {
        clinicId: clinicB.id,
        name: "Branch B",
        slug: `branch-b-${Date.now()}`,
        address: "2 Test St",
        city: "Test City",
        phone: "0000",
        operatingHours: {},
      },
    })
    // Same clinic as branchA — the failure mode the branch tier introduces
    // that no cross-*clinic* fixture can catch.
    siblingOfA = await superuserPrisma.branch.create({
      data: {
        clinicId: clinicA.id,
        name: "Branch A — sibling",
        slug: `branch-a-sibling-${Date.now()}`,
        address: "3 Test St",
        city: "Test City",
        phone: "0000",
        operatingHours: {},
      },
    })

    const userA = await superuserPrisma.user.create({
      data: {
        branchId: branchA.id,
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

    frontDeskA = { id: userA.id, role: Role.FRONT_DESK, branchId: branchA.id, holdingCompanyId: null }
    holdingAdmin = { id: userHolding.id, role: Role.HOLDING_ADMIN, branchId: null, holdingCompanyId: holding.id }

    patientA = await superuserPrisma.patient.create({
      data: {
        branchId: branchA.id,
        firstName: "Alice",
        lastName: "InBranchA",
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
        branchId: branchB.id,
        firstName: "Bob",
        lastName: "InBranchB",
        birthdate: new Date("1985-05-05"),
        sex: Sex.MALE,
        phone: "333",
        address: "addr",
        emergencyContactName: "ec",
        emergencyContactPhone: "444",
      },
    })
    patientInSibling = await superuserPrisma.patient.create({
      data: {
        branchId: siblingOfA.id,
        firstName: "Carol",
        lastName: "InSiblingBranch",
        birthdate: new Date("1992-09-09"),
        sex: Sex.FEMALE,
        phone: "555",
        address: "addr",
        emergencyContactName: "ec",
        emergencyContactPhone: "666",
      },
    })
  })

  afterAll(async () => {
    const clinicIds = (
      await superuserPrisma.branch.findMany({ where: { id: { in: [branchA.id, branchB.id, siblingOfA.id] } }, select: { clinicId: true } })
    ).map((b) => b.clinicId)
    await superuserPrisma.auditLog.deleteMany({ where: { branchId: { in: [branchA.id, branchB.id, siblingOfA.id] } } })
    await superuserPrisma.patient.deleteMany({ where: { branchId: { in: [branchA.id, branchB.id, siblingOfA.id] } } })
    await superuserPrisma.user.deleteMany({ where: { branchId: { in: [branchA.id, branchB.id, siblingOfA.id] } } })
    await superuserPrisma.user.delete({ where: { id: holdingAdmin.id } })
    await superuserPrisma.branch.deleteMany({ where: { id: { in: [branchA.id, branchB.id, siblingOfA.id] } } })
    await superuserPrisma.clinic.deleteMany({ where: { id: { in: clinicIds } } })
    await superuserPrisma.holdingCompany.deleteMany({ where: { name: "Test Holding" } })
    await superuserPrisma.$disconnect()
    await prisma.$disconnect()
  })

  it("lets a front desk user read a patient in their own branch, and audit-logs it", async () => {
    const result = await getPatientById(frontDeskA, patientA.id)
    expect(result?.id).toBe(patientA.id)

    const log = await superuserPrisma.auditLog.findFirst({
      where: { entityId: patientA.id, action: "patient.read", userId: frontDeskA.id },
    })
    expect(log).toBeTruthy()
  })

  it("403s a front desk user reading another branch's patient by direct id, and audit-logs the attempt", async () => {
    await expect(getPatientById(frontDeskA, patientB.id)).rejects.toBeInstanceOf(ForbiddenError)

    const log = await superuserPrisma.auditLog.findFirst({
      where: { entityId: patientB.id, action: "patient.read.denied", userId: frontDeskA.id },
    })
    expect(log).toBeTruthy()
    expect((log?.changes as { attemptedBranchId?: string } | null)?.attemptedBranchId).toBe(branchB.id)
  })

  it("returns null (not forbidden) for an id that doesn't exist anywhere", async () => {
    const result = await getPatientById(frontDeskA, "00000000-0000-0000-0000-000000000000")
    expect(result).toBeNull()
  })

  it("lets a holding admin read a patient in any branch", async () => {
    const result = await getPatientById(holdingAdmin, patientB.id)
    expect(result?.id).toBe(patientB.id)
  })

  it("scopes listPatients to the caller's own branch", async () => {
    const results = await listPatients(frontDeskA)
    expect(results.map((p) => p.id)).toContain(patientA.id)
    expect(results.map((p) => p.id)).not.toContain(patientB.id)
  })

  it("403s a sibling branch under the same clinic — sharing a parent buys no access", async () => {
    await expect(getPatientById(frontDeskA, patientInSibling.id)).rejects.toBeInstanceOf(ForbiddenError)

    const log = await superuserPrisma.auditLog.findFirst({
      where: { entityId: patientInSibling.id, action: "patient.read.denied", userId: frontDeskA.id },
    })
    expect((log?.changes as { attemptedBranchId?: string } | null)?.attemptedBranchId).toBe(siblingOfA.id)

    const results = await listPatients(frontDeskA)
    expect(results.map((p) => p.id)).not.toContain(patientInSibling.id)
  })

  it("RLS backstop: the sibling branch's rows are hidden at the database layer too", async () => {
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.role', ${Role.FRONT_DESK}, true)`
      await tx.$executeRaw`SELECT set_config('app.user_id', ${frontDeskA.id}, true)`
      await tx.$executeRaw`SELECT set_config('app.branch_id', ${branchA.id}, true)`
      return tx.patient.findMany({ where: { id: patientInSibling.id } })
    })
    expect(rows).toHaveLength(0)

    // Positive control for both backstop tests above: a policy that hid
    // every row unconditionally would satisfy their toHaveLength(0) just
    // as well. Same unfiltered query, same code path, only the branch GUC
    // differs — so this passing is what proves the policy is keyed on
    // app.branch_id rather than simply blocking everything.
    const visible = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.role', ${Role.FRONT_DESK}, true)`
      await tx.$executeRaw`SELECT set_config('app.user_id', ${frontDeskA.id}, true)`
      await tx.$executeRaw`SELECT set_config('app.branch_id', ${siblingOfA.id}, true)`
      return tx.patient.findMany({ where: { id: patientInSibling.id } })
    })
    expect(visible).toHaveLength(1)
  })

  it("RLS backstop: an unfiltered raw query under Branch A's session context cannot see Branch B's patient, independent of the app-layer check", async () => {
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.role', ${Role.FRONT_DESK}, true)`
      await tx.$executeRaw`SELECT set_config('app.user_id', ${frontDeskA.id}, true)`
      await tx.$executeRaw`SELECT set_config('app.branch_id', ${branchA.id}, true)`
      // deliberately unfiltered — proves the DB itself hides the row, not just the app query's WHERE clause
      return tx.patient.findMany({ where: { id: patientB.id } })
    })
    expect(rows).toHaveLength(0)
  })
})
