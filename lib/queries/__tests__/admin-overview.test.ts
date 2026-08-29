import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { Role } from "@prisma/client"
import { superuserPrisma } from "@/lib/test/superuser-prisma"
import { prisma } from "@/lib/db/prisma"
import { getAdminOverview, ATTENTION_LIST_LIMIT } from "@/lib/queries/admin-overview"
import { ForbiddenError } from "@/lib/permissions/errors"
import type { AbilitySubject } from "@/lib/permissions/ability"

/**
 * The /console/admin overview. The interesting cases are the ones the page
 * uses to tell an admin something is wrong — a clinic with no branch, an
 * active branch with nobody in it, an account still on its temporary
 * password — plus the company bound, since this query reads across every
 * clinic at once and `clinics`/`branches`/`users` have no RLS underneath it.
 */
describe("getAdminOverview", () => {
  const stamp = Date.now()
  let companyId: string
  let otherCompanyId: string
  let clinicWithBranches: { id: string }
  let emptyClinic: { id: string }
  let staffedBranch: { id: string }
  let emptyBranch: { id: string }
  let inactiveEmptyBranch: { id: string }
  let otherBranchId: string
  let admin: AbilitySubject
  let lockedUserId: string
  let mustChangeUserId: string

  async function makeBranch(clinicId: string, name: string, slug: string, isActive = true) {
    return superuserPrisma.branch.create({
      data: {
        clinicId,
        name,
        slug: `${slug}-${stamp}`,
        address: "1 Overview St",
        city: "Overview City",
        phone: "0000",
        operatingHours: {},
        isActive,
      },
    })
  }

  async function makeUser(opts: {
    branchId?: string
    holdingCompanyId?: string
    name: string
    email: string
    role: Role
    lockedUntil?: Date
    mustChangePassword?: boolean
    isActive?: boolean
  }) {
    return superuserPrisma.user.create({
      data: {
        branchId: opts.branchId ?? null,
        holdingCompanyId: opts.holdingCompanyId ?? null,
        name: opts.name,
        email: `${opts.email}-${stamp}@test.local`,
        passwordHash: "x",
        role: opts.role,
        lockedUntil: opts.lockedUntil ?? null,
        mustChangePassword: opts.mustChangePassword ?? false,
        isActive: opts.isActive ?? true,
      },
    })
  }

  beforeAll(async () => {
    const company = await superuserPrisma.holdingCompany.create({ data: { name: `Overview Co ${stamp}` } })
    companyId = company.id
    const other = await superuserPrisma.holdingCompany.create({ data: { name: `Overview Other ${stamp}` } })
    otherCompanyId = other.id

    clinicWithBranches = await superuserPrisma.clinic.create({
      data: { holdingCompanyId: companyId, name: `AAA Overview Clinic ${stamp}` },
    })
    emptyClinic = await superuserPrisma.clinic.create({
      data: { holdingCompanyId: companyId, name: `ZZZ Empty Clinic ${stamp}` },
    })

    staffedBranch = await makeBranch(clinicWithBranches.id, "Overview Staffed", "ov-staffed")
    emptyBranch = await makeBranch(clinicWithBranches.id, "Overview Empty", "ov-empty")
    // Inactive AND empty — must not be reported as needing staff.
    inactiveEmptyBranch = await makeBranch(clinicWithBranches.id, "Overview Closed", "ov-closed", false)

    const owner = await makeUser({
      holdingCompanyId: companyId,
      name: "Overview Owner",
      email: "ov-owner",
      role: Role.HOLDING_ADMIN,
    })
    admin = { id: owner.id, role: Role.HOLDING_ADMIN, branchId: null, holdingCompanyId: companyId }

    await makeUser({ branchId: staffedBranch.id, name: "Overview Staff One", email: "ov-s1", role: Role.FRONT_DESK })
    await makeUser({
      branchId: staffedBranch.id,
      name: "Overview Staff Two",
      email: "ov-s2",
      role: Role.FRONT_DESK,
      isActive: false,
    })
    const locked = await makeUser({
      branchId: staffedBranch.id,
      name: "Overview Locked",
      email: "ov-locked",
      role: Role.DOCTOR,
      lockedUntil: new Date(Date.now() + 60 * 60_000),
    })
    lockedUserId = locked.id
    const mustChange = await makeUser({
      branchId: staffedBranch.id,
      name: "Overview MustChange",
      email: "ov-mustchange",
      role: Role.FRONT_DESK,
      mustChangePassword: true,
    })
    mustChangeUserId = mustChange.id

    // A whole separate tenant that must never appear.
    const otherClinic = await superuserPrisma.clinic.create({
      data: { holdingCompanyId: otherCompanyId, name: `Other Co Clinic ${stamp}` },
    })
    const otherBranch = await makeBranch(otherClinic.id, "Other Co Branch", "ov-other")
    otherBranchId = otherBranch.id
    await makeUser({ branchId: otherBranch.id, name: "Other Co Staff", email: "ov-other-staff", role: Role.FRONT_DESK })
    await makeUser({
      holdingCompanyId: otherCompanyId,
      name: "Other Co Owner",
      email: "ov-other-owner",
      role: Role.HOLDING_ADMIN,
    })
  })

  afterAll(async () => {
    const companyIds = [companyId, otherCompanyId]
    const branchIds = [staffedBranch.id, emptyBranch.id, inactiveEmptyBranch.id, otherBranchId]
    await superuserPrisma.auditLog.deleteMany({ where: { branchId: { in: branchIds } } })
    await superuserPrisma.user.deleteMany({ where: { branchId: { in: branchIds } } })
    await superuserPrisma.user.deleteMany({ where: { holdingCompanyId: { in: companyIds } } })
    await superuserPrisma.branch.deleteMany({ where: { id: { in: branchIds } } })
    await superuserPrisma.clinic.deleteMany({ where: { holdingCompanyId: { in: companyIds } } })
    await superuserPrisma.holdingCompany.deleteMany({ where: { id: { in: companyIds } } })
    await superuserPrisma.$disconnect()
    await prisma.$disconnect()
  })

  it("refuses a non-holding-admin", async () => {
    const clinicAdmin: AbilitySubject = {
      id: "someone",
      role: Role.CLINIC_ADMIN,
      branchId: staffedBranch.id,
      holdingCompanyId: null,
    }
    await expect(getAdminOverview(clinicAdmin)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("names the caller's own company", async () => {
    const o = await getAdminOverview(admin)
    expect(o.company?.id).toBe(companyId)
    expect(o.company?.name).toBe(`Overview Co ${stamp}`)
  })

  it("returns every clinic in the company with its branches and per-branch staff counts", async () => {
    const o = await getAdminOverview(admin)
    const clinic = o.clinics.find((c) => c.id === clinicWithBranches.id)
    expect(clinic).toBeTruthy()

    const staffed = clinic!.branches.find((b) => b.id === staffedBranch.id)
    // Four accounts sit in this branch, one of them deactivated — the count
    // is of people attached to the branch, not of people who can log in.
    expect(staffed!.staffCount).toBe(4)
    expect(clinic!.branches.find((b) => b.id === emptyBranch.id)!.staffCount).toBe(0)
    // The clinic total is the sum of its branches.
    expect(clinic!.staffCount).toBe(4)
  })

  it("excludes every other company's clinics, branches and accounts", async () => {
    const o = await getAdminOverview(admin)
    expect(o.clinics.every((c) => c.name.startsWith("AAA Overview") || c.name.startsWith("ZZZ Empty"))).toBe(true)
    expect(o.clinics.flatMap((c) => c.branches).some((b) => b.id === otherBranchId)).toBe(false)
    expect(o.holdingAccounts.some((a) => a.name === "Other Co Owner")).toBe(false)
    // Positive control: the caller's own company-level account IS present,
    // so the exclusion above is a company bound rather than an empty result.
    expect(o.holdingAccounts.some((a) => a.id === admin.id)).toBe(true)
  })

  it("flags a clinic that has no branches", async () => {
    const o = await getAdminOverview(admin)
    expect(o.attention.clinicsWithoutBranches.map((c) => c.id)).toContain(emptyClinic.id)
    expect(o.attention.clinicsWithoutBranches.map((c) => c.id)).not.toContain(clinicWithBranches.id)
  })

  it("flags an active branch with no staff, but not a deactivated one", async () => {
    const o = await getAdminOverview(admin)
    const ids = o.attention.branchesWithoutStaff.map((b) => b.id)
    expect(ids).toContain(emptyBranch.id)
    // A closed branch having nobody in it is the expected end state, not a
    // task — this is the assertion that keeps the panel actionable.
    expect(ids).not.toContain(inactiveEmptyBranch.id)
    expect(ids).not.toContain(staffedBranch.id)
  })

  it("flags an active account still attached to a deactivated branch", async () => {
    const stranded = await makeUser({
      branchId: inactiveEmptyBranch.id,
      name: "Overview Stranded",
      email: "ov-stranded",
      role: Role.FRONT_DESK,
    })
    // A deactivated account in the same closed branch is NOT a problem —
    // that is the tidy end state, and including it would make the panel
    // fire on every properly-closed branch.
    const alsoClosed = await makeUser({
      branchId: inactiveEmptyBranch.id,
      name: "Overview Closed Properly",
      email: "ov-closed-ok",
      role: Role.FRONT_DESK,
      isActive: false,
    })

    const o = await getAdminOverview(admin)
    const ids = o.attention.strandedInClosedBranch.map((a) => a.id)
    expect(ids).toContain(stranded.id)
    expect(ids).not.toContain(alsoClosed.id)
    // An active account in an ACTIVE branch must not appear either — the
    // condition is the join, not either half of it.
    expect(o.attention.strandedInClosedBranch.every((a) => a.branchName === "Overview Closed")).toBe(true)
    expect(o.totals.strandedInClosedBranch).toBe(1)

    await superuserPrisma.user.deleteMany({ where: { id: { in: [stranded.id, alsoClosed.id] } } })
  })

  it("reports no stranded accounts when every closed branch is empty", async () => {
    // The control for the test above: with the fixture's closed branch
    // unpopulated, the panel stays silent rather than firing on the branch
    // merely being inactive.
    const o = await getAdminOverview(admin)
    expect(o.attention.strandedInClosedBranch).toEqual([])
    expect(o.totals.strandedInClosedBranch).toBe(0)
  })

  it("reports locked-out and must-change-password accounts", async () => {
    const o = await getAdminOverview(admin)
    expect(o.attention.lockedOut.map((a) => a.id)).toContain(lockedUserId)
    expect(o.totals.lockedOut).toBe(1)

    expect(o.attention.mustChangePassword.map((a) => a.id)).toContain(mustChangeUserId)
    expect(o.totals.mustChangePassword).toBe(1)
  })

  it("counts a deactivated account without treating it as a live problem", async () => {
    const o = await getAdminOverview(admin)
    // 4 branch users + 1 company-level owner.
    expect(o.totals.staff).toBe(5)
    expect(o.totals.inactiveStaff).toBe(1)
  })

  it("counts inactive branches", async () => {
    const o = await getAdminOverview(admin)
    expect(o.totals.clinics).toBe(2)
    expect(o.totals.branches).toBe(3)
    expect(o.totals.inactiveBranches).toBe(1)
  })

  it("caps each attention list but keeps the total honest", async () => {
    // Push past the cap so the "showing N of M" path is exercised rather
    // than assumed — a list that silently truncated to its own length would
    // read as "everything is fine".
    const extras = []
    for (let i = 0; i < ATTENTION_LIST_LIMIT + 2; i++) {
      extras.push(
        await makeUser({
          branchId: emptyBranch.id,
          name: `Overview Bulk ${i}`,
          email: `ov-bulk-${i}`,
          role: Role.FRONT_DESK,
          mustChangePassword: true,
        })
      )
    }

    const o = await getAdminOverview(admin)
    expect(o.attention.mustChangePassword).toHaveLength(ATTENTION_LIST_LIMIT)
    expect(o.totals.mustChangePassword).toBe(ATTENTION_LIST_LIMIT + 3) // +2 extras beyond the cap, +1 original
    expect(o.totals.mustChangePassword).toBeGreaterThan(o.attention.mustChangePassword.length)

    await superuserPrisma.user.deleteMany({ where: { id: { in: extras.map((e) => e.id) } } })
  })
})
