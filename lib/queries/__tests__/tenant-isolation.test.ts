import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { Role, type Prisma } from "@prisma/client"
import { superuserPrisma } from "@/lib/test/superuser-prisma"
import { prisma } from "@/lib/db/prisma"
import { appendAuditLog } from "@/lib/db/rls"
import { listClinics, getClinicById } from "@/lib/queries/clinics"
import { listBranches, getBranchById } from "@/lib/queries/branches"
import {
  listUsers,
  listUsersForClinic,
  listUsersForBranch,
  getManagedUserById,
  setUserActive,
  updateUser,
  forcePasswordReset,
  unlockAccount,
} from "@/lib/queries/users"
import type { AbilitySubject } from "@/lib/permissions/ability"

/**
 * The boundary between two HoldingCompanies.
 *
 * Every other suite in this repo builds a single holding company, so a
 * missing tenant predicate is invisible to them: with one company in the
 * database, "every row" and "my company's rows" are the same set. These
 * tests exist to make that difference observable.
 *
 * It matters more here than at the branch level because clinics, branches,
 * users and doctors carry NO RLS policy — for those tables the query-layer
 * where-clause is the entire boundary, with no database backstop underneath
 * it. A holding admin is unscoped *within* their company, never across.
 */
describe("holding-company isolation", () => {
  const stamp = Date.now()
  let companyA: { id: string }
  let companyB: { id: string }
  let clinicA: { id: string }
  let clinicB: { id: string }
  let branchA: { id: string }
  let branchB: { id: string }
  let adminA: AbilitySubject
  let adminB: AbilitySubject
  let staffAId: string
  let staffBId: string
  let ownerBId: string

  async function makeCompany(label: string) {
    const company = await superuserPrisma.holdingCompany.create({
      data: { name: `Tenant ${label} ${stamp}` },
    })
    const clinic = await superuserPrisma.clinic.create({
      data: { holdingCompanyId: company.id, name: `Tenant ${label} Clinic ${stamp}` },
    })
    const branch = await superuserPrisma.branch.create({
      data: {
        clinicId: clinic.id,
        name: `Tenant ${label} Branch`,
        slug: `tenant-${label.toLowerCase()}-${stamp}`,
        address: "1 Tenant St",
        city: "Tenant City",
        phone: "0000",
        operatingHours: {},
      },
    })
    const owner = await superuserPrisma.user.create({
      data: {
        holdingCompanyId: company.id,
        name: `Tenant ${label} Owner`,
        email: `tenant-${label.toLowerCase()}-owner-${stamp}@test.local`,
        passwordHash: "x",
        role: Role.HOLDING_ADMIN,
      },
    })
    const staff = await superuserPrisma.user.create({
      data: {
        branchId: branch.id,
        name: `Tenant ${label} Staff`,
        email: `tenant-${label.toLowerCase()}-staff-${stamp}@test.local`,
        passwordHash: "x",
        role: Role.FRONT_DESK,
      },
    })
    return { company, clinic, branch, owner, staff }
  }

  beforeAll(async () => {
    const a = await makeCompany("A")
    const b = await makeCompany("B")
    companyA = a.company
    companyB = b.company
    clinicA = a.clinic
    clinicB = b.clinic
    branchA = a.branch
    branchB = b.branch
    staffAId = a.staff.id
    staffBId = b.staff.id
    ownerBId = b.owner.id
    adminA = {
      id: a.owner.id,
      role: Role.HOLDING_ADMIN,
      branchId: null,
      clinicId: null,
      holdingCompanyId: a.company.id,
    }
    adminB = {
      id: b.owner.id,
      role: Role.HOLDING_ADMIN,
      branchId: null,
      clinicId: null,
      holdingCompanyId: b.company.id,
    }
  })

  afterAll(async () => {
    const companyIds = [companyA.id, companyB.id]
    const branchIds = [branchA.id, branchB.id]
    await superuserPrisma.auditLog.deleteMany({ where: { branchId: { in: branchIds } } })
    await superuserPrisma.user.deleteMany({ where: { branchId: { in: branchIds } } })
    await superuserPrisma.user.deleteMany({ where: { holdingCompanyId: { in: companyIds } } })
    await superuserPrisma.branch.deleteMany({ where: { id: { in: branchIds } } })
    await superuserPrisma.clinic.deleteMany({ where: { holdingCompanyId: { in: companyIds } } })
    await superuserPrisma.holdingCompany.deleteMany({ where: { id: { in: companyIds } } })
    await superuserPrisma.$disconnect()
    await prisma.$disconnect()
  })

  /**
   * The control the rest of the suite rests on. Every assertion below is of
   * the form "admin A cannot see B's row", which would also pass if B's rows
   * did not exist, or if these queries returned nothing to anyone. Proving B
   * can reach its own data establishes that the rows are real and findable,
   * so A's exclusions are a boundary rather than an empty result.
   */
  it("company B's own admin sees company B's data — so A's exclusions below mean something", async () => {
    expect((await listClinics(adminB)).some((c) => c.id === clinicB.id)).toBe(true)
    expect((await listBranches(adminB)).some((b) => b.id === branchB.id)).toBe(true)
    expect((await listUsers(adminB)).some((u) => u.id === staffBId)).toBe(true)
    expect(await getClinicById(adminB, clinicB.id)).not.toBeNull()
    expect(await getBranchById(adminB, branchB.id)).not.toBeNull()
    expect(await getManagedUserById(adminB, staffBId)).not.toBeNull()
  })

  it("listClinics returns only the caller's own company's clinics", async () => {
    const rows = await listClinics(adminA)
    // Positive control first: if the query returned nothing at all, the
    // exclusion below would pass for the wrong reason.
    expect(rows.some((c) => c.id === clinicA.id)).toBe(true)
    expect(rows.some((c) => c.id === clinicB.id)).toBe(false)
  })

  it("getClinicById reads another company's clinic as simply absent", async () => {
    expect(await getClinicById(adminA, clinicA.id)).not.toBeNull()
    expect(await getClinicById(adminA, clinicB.id)).toBeNull()
  })

  it("listBranches returns only the caller's own company's branches", async () => {
    const rows = await listBranches(adminA)
    expect(rows.some((b) => b.id === branchA.id)).toBe(true)
    expect(rows.some((b) => b.id === branchB.id)).toBe(false)
  })

  it("listBranches cannot be widened by passing another company's clinicId", async () => {
    // The filter argument narrows within the company bound; it must never
    // reach past it, or the bound would be caller-controlled.
    expect(await listBranches(adminA, { clinicId: clinicB.id })).toEqual([])
  })

  it("getBranchById reads another company's branch as simply absent", async () => {
    expect(await getBranchById(adminA, branchA.id)).not.toBeNull()
    expect(await getBranchById(adminA, branchB.id)).toBeNull()
  })

  it("listUsers returns only the caller's own company's accounts", async () => {
    const rows = await listUsers(adminA)
    expect(rows.some((u) => u.id === staffAId)).toBe(true)
    expect(rows.some((u) => u.id === staffBId)).toBe(false)
    // Company B's holding admin has a null branchId, so they are reachable
    // only through the holdingCompanyId arm of the scope — the arm most
    // easily forgotten.
    expect(rows.some((u) => u.id === ownerBId)).toBe(false)
  })

  it("listUsers still includes the caller's own branchless holding admin", async () => {
    const rows = await listUsers(adminA)
    expect(rows.some((u) => u.id === adminA.id)).toBe(true)
  })

  it("listUsersForClinic and listUsersForBranch cannot reach another company", async () => {
    expect((await listUsersForClinic(adminA, clinicA.id)).some((u) => u.id === staffAId)).toBe(true)
    expect(await listUsersForClinic(adminA, clinicB.id)).toEqual([])

    expect((await listUsersForBranch(adminA, branchA.id)).some((u) => u.id === staffAId)).toBe(true)
    expect(await listUsersForBranch(adminA, branchB.id)).toEqual([])
  })

  it("getManagedUserById reads another company's account as absent", async () => {
    expect(await getManagedUserById(adminA, staffAId)).not.toBeNull()
    expect(await getManagedUserById(adminA, staffBId)).toBeNull()
  })

  it("refuses every management action against another company's account", async () => {
    const notFound = { ok: false, error: "User not found." }
    expect(await setUserActive(adminA, staffBId, false)).toEqual(notFound)
    expect(await updateUser(adminA, staffBId, { name: "Hijacked" })).toEqual(notFound)
    expect(await forcePasswordReset(adminA, staffBId)).toEqual(notFound)
    expect(await unlockAccount(adminA, staffBId)).toEqual(notFound)

    // Nothing may have changed on the victim row.
    const victim = await superuserPrisma.user.findUniqueOrThrow({ where: { id: staffBId } })
    expect(victim.name).toBe(`Tenant B Staff`)
    expect(victim.isActive).toBe(true)
  })

  it("still manages accounts inside the caller's own company", async () => {
    // The positive control for the whole suite: the bound must exclude the
    // other tenant without disabling the admin's real job. A scope that
    // refused everything would satisfy every assertion above.
    expect(await setUserActive(adminA, staffAId, false)).toEqual({ ok: true })
    expect((await superuserPrisma.user.findUniqueOrThrow({ where: { id: staffAId } })).isActive).toBe(false)
    expect(await setUserActive(adminA, staffAId, true)).toEqual({ ok: true })
  })
})

/**
 * The clinic-level admin's boundary against the policied tables.
 *
 * The audit_logs_clinic_admin_insert migration adds `app.clinic_id` and an
 * INSERT arm for it on audit_logs, so a branchless clinic admin can write the
 * audit row for an account or branch it just created. That is the ONLY
 * widening. The SELECT policy sits two lines above the INSERT policy in that
 * migration, which is exactly where a careless follow-up would copy the new
 * arm — and audit rows carry patient.read entityIds, i.e. operational data
 * this role must never see. This is the negative control that pins it, run
 * as the RLS-bound app role with the GUCs set the way lib/db/rls.ts sets them.
 */
describe("clinic-admin isolation", () => {
  const stamp = Date.now()
  let holdingId: string
  let clinicId: string
  let branchId: string
  let clinicAdminId: string

  beforeAll(async () => {
    const holding = await superuserPrisma.holdingCompany.create({ data: { name: `Clinic Admin Isolation ${stamp}` } })
    holdingId = holding.id
    const clinic = await superuserPrisma.clinic.create({ data: { holdingCompanyId: holding.id, name: `CA Clinic ${stamp}` } })
    clinicId = clinic.id
    const branch = await superuserPrisma.branch.create({
      data: {
        clinicId: clinic.id,
        name: "CA Branch",
        slug: `ca-branch-${stamp}`,
        address: "1 CA St",
        city: "CA City",
        phone: "0000",
        operatingHours: {},
      },
    })
    branchId = branch.id
    const admin = await superuserPrisma.user.create({
      data: {
        clinicId: clinic.id,
        name: "CA Admin",
        email: `ca-admin-${stamp}@test.local`,
        passwordHash: "x",
        role: Role.CLINIC_ADMIN,
      },
    })
    clinicAdminId = admin.id
    // Rows at the clinic's own branch — the ones a careless SELECT widening
    // would expose. A patient, and an audit row that names it.
    const patient = await superuserPrisma.patient.create({
      data: {
        branchId: branch.id,
        firstName: "Hidden",
        lastName: "Patient",
        birthdate: new Date("1990-01-01"),
        sex: "FEMALE",
        phone: "000",
        address: "addr",
        emergencyContactName: "ec",
        emergencyContactPhone: "000",
      },
    })
    await superuserPrisma.auditLog.create({
      data: { branchId: branch.id, action: "patient.read", entityType: "Patient", entityId: patient.id },
    })
  })

  afterAll(async () => {
    await superuserPrisma.auditLog.deleteMany({ where: { branchId } })
    await superuserPrisma.patient.deleteMany({ where: { branchId } })
    await superuserPrisma.user.deleteMany({ where: { clinicId } })
    await superuserPrisma.branch.deleteMany({ where: { id: branchId } })
    await superuserPrisma.clinic.deleteMany({ where: { id: clinicId } })
    await superuserPrisma.holdingCompany.deleteMany({ where: { id: holdingId } })
  })

  /** Exactly what lib/db/rls.ts's runWithRls sets for this role: a real clinic id, and an EMPTY branch id. */
  function asClinicAdmin<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT
        set_config('app.role', 'CLINIC_ADMIN', true),
        set_config('app.user_id', ${clinicAdminId}, true),
        set_config('app.branch_id', '', true),
        set_config('app.clinic_id', ${clinicId}, true)`
      return fn(tx)
    })
  }

  it("the clinic GUC widens audit_logs INSERT only — never SELECT, on any policied table", async () => {
    const seen = await asClinicAdmin(async (tx) => ({
      patients: await tx.patient.findMany({ where: { branchId } }),
      queue: await tx.queueEntry.findMany({ where: { branchId } }),
      payments: await tx.payment.findMany({ where: { branchId } }),
      consultations: await tx.consultation.findMany({ where: { branchId } }),
      medicines: await tx.medicine.findMany({ where: { branchId } }),
      audit: await tx.auditLog.findMany({ where: { branchId } }),
    }))
    for (const [table, rows] of Object.entries(seen)) {
      expect(rows, `${table} visible to a clinic admin at its own clinic's branch`).toHaveLength(0)
    }
  })

  it("...but can write the audit row for a branch under its clinic — via the write path the app uses", async () => {
    // Positive control for the INSERT arm, and proof the test above passed
    // for the right reason: the same session CAN insert, so the empty reads
    // are policy, not a broken connection or a missing row.
    await asClinicAdmin((tx) =>
      appendAuditLog(tx, {
        data: { branchId, userId: clinicAdminId, action: "branch.deactivated", entityType: "Branch", entityId: branchId },
      })
    )
    const persisted = await superuserPrisma.auditLog.findFirst({
      where: { action: "branch.deactivated", entityId: branchId, userId: clinicAdminId },
    })
    expect(persisted?.branchId).toBe(branchId)
  })

  it("the same INSERT with RETURNING is refused — which is why appendAuditLog exists", async () => {
    // Postgres checks a RETURNING row against the SELECT policy, and the
    // SELECT policy has no clinic arm on purpose. Prisma's `create` always
    // emits RETURNING, so every audit write a clinic admin can reach goes
    // through lib/db/rls.ts's appendAuditLog (createMany, no RETURNING). If
    // this ever starts passing, the SELECT policy has been widened — go and
    // find out why before celebrating.
    await expect(
      asClinicAdmin((tx) =>
        tx.auditLog.create({
          data: { branchId, userId: clinicAdminId, action: "branch.reactivated", entityType: "Branch", entityId: branchId },
        })
      )
    ).rejects.toThrow(/row-level security|42501/)
  })

  it("a holding-admin session sees the same rows — so the policy hides them selectively, not unconditionally", async () => {
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT
        set_config('app.role', 'HOLDING_ADMIN', true),
        set_config('app.user_id', '', true),
        set_config('app.branch_id', '', true),
        set_config('app.clinic_id', '', true)`
      return tx.patient.findMany({ where: { branchId } })
    })
    expect(rows).toHaveLength(1)
  })
})
