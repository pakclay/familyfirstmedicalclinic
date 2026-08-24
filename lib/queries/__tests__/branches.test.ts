import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { Role } from "@prisma/client"
import { superuserPrisma } from "@/lib/test/superuser-prisma"
import { prisma } from "@/lib/db/prisma"
import {
  listBranches,
  getBranchById,
  createBranch,
  updateBranch,
  setBranchActive,
  getOwnBranch,
  updateOwnBranchSettings,
} from "@/lib/queries/branches"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { ForbiddenError } from "@/lib/permissions/errors"
import type {
  BranchSettingsInput,
  CreateBranchInput,
  EditBranchInput,
} from "@/lib/validation/branch"
import type { OperatingHours } from "@/lib/validation/operating-hours"

const STANDARD_HOURS: OperatingHours = {
  mon: { open: "09:00", close: "18:00" },
  tue: { open: "09:00", close: "18:00" },
  wed: { open: "09:00", close: "18:00" },
  thu: { open: "09:00", close: "18:00" },
  fri: { open: "09:00", close: "18:00" },
  sat: { open: "08:00", close: "12:00" },
  sun: null,
}

function branchInput(overrides: Partial<CreateBranchInput> = {}): CreateBranchInput {
  return {
    name: "New Branch",
    slug: `new-branch-${Date.now()}-${Math.floor(Math.random() * 10_000)}`,
    address: "10 Test Ave",
    city: "Test City",
    phone: "+63 900 000 0000",
    facebookPageUrl: "",
    timezone: "Asia/Manila",
    operatingHours: STANDARD_HOURS,
    ...overrides,
  }
}

describe("branch management", () => {
  let holding: { id: string }
  let clinic: { id: string }
  let otherClinic: { id: string }
  let existingBranch: { id: string }
  let holdingAdmin: AbilitySubject
  let clinicAdmin: AbilitySubject

  beforeAll(async () => {
    holding = await superuserPrisma.holdingCompany.create({ data: { name: "Test Holding — branch mgmt" } })
    clinic = await superuserPrisma.clinic.create({ data: { holdingCompanyId: holding.id, name: "Test Clinic" } })
    otherClinic = await superuserPrisma.clinic.create({ data: { holdingCompanyId: holding.id, name: "Other Clinic" } })
    existingBranch = await superuserPrisma.branch.create({
      data: {
        clinicId: clinic.id,
        name: "AAA Existing Branch",
        slug: `existing-branch-${Date.now()}`,
        address: "1 Test St",
        city: "Test City",
        phone: "0000",
        operatingHours: STANDARD_HOURS,
      },
    })

    const holdingUser = await superuserPrisma.user.create({
      data: {
        holdingCompanyId: holding.id,
        name: "Holding Owner",
        email: `owner-branches-${Date.now()}@test.local`,
        passwordHash: "x",
        role: Role.HOLDING_ADMIN,
      },
    })
    holdingAdmin = { id: holdingUser.id, role: Role.HOLDING_ADMIN, branchId: null, holdingCompanyId: holding.id }

    const adminUser = await superuserPrisma.user.create({
      data: {
        branchId: existingBranch.id,
        name: "Clinic Admin",
        email: `admin-branches-${Date.now()}@test.local`,
        passwordHash: "x",
        role: Role.CLINIC_ADMIN,
      },
    })
    clinicAdmin = { id: adminUser.id, role: Role.CLINIC_ADMIN, branchId: existingBranch.id, holdingCompanyId: null }
  })

  afterAll(async () => {
    const clinicIds = [clinic.id, otherClinic.id]
    const branches = await superuserPrisma.branch.findMany({ where: { clinicId: { in: clinicIds } }, select: { id: true } })
    const branchIds = branches.map((b) => b.id)
    await superuserPrisma.auditLog.deleteMany({ where: { branchId: { in: branchIds } } })
    await superuserPrisma.user.deleteMany({ where: { branchId: { in: branchIds } } })
    await superuserPrisma.user.deleteMany({ where: { holdingCompanyId: holding.id } })
    await superuserPrisma.branch.deleteMany({ where: { id: { in: branchIds } } })
    await superuserPrisma.clinic.deleteMany({ where: { id: { in: clinicIds } } })
    await superuserPrisma.holdingCompany.deleteMany({ where: { id: holding.id } })
    await superuserPrisma.$disconnect()
    await prisma.$disconnect()
  })

  it("lets a holding admin create a branch under a clinic, and audit-logs it in the same transaction", async () => {
    const input = branchInput({ name: "Makati Branch", facebookPageUrl: "https://facebook.com/familyfirst.makati" })
    const result = await createBranch(holdingAdmin, clinic.id, input)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.branch.name).toBe("Makati Branch")
    expect(result.branch.slug).toBe(input.slug)
    expect(result.branch.clinicId).toBe(clinic.id)
    expect(result.branch.isActive).toBe(true)
    expect(result.branch.facebookPageUrl).toBe("https://facebook.com/familyfirst.makati")
    expect(result.branch.operatingHours).toEqual(STANDARD_HOURS)

    const row = await superuserPrisma.branch.findUniqueOrThrow({ where: { id: result.branch.id } })
    expect(row.clinicId).toBe(clinic.id)
    expect(row.timezone).toBe("Asia/Manila")

    // `audit_logs` *does* have an RLS policy (unlike `branches`), so this
    // row only exists if the whole transaction ran through runWithRls with
    // the app.role/app.user_id GUCs set.
    const log = await superuserPrisma.auditLog.findFirst({
      where: { entityType: "Branch", entityId: result.branch.id, action: "branch.created" },
    })
    expect(log).toBeTruthy()
    expect(log!.userId).toBe(holdingAdmin.id)
  })

  it("stores an empty Facebook URL as null", async () => {
    const result = await createBranch(holdingAdmin, clinic.id, branchInput({ name: "No Facebook Branch" }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.branch.facebookPageUrl).toBeNull()
  })

  it("rejects a duplicate slug", async () => {
    const slug = `dupe-branch-${Date.now()}`
    const first = await createBranch(holdingAdmin, clinic.id, branchInput({ name: "First", slug }))
    expect(first.ok).toBe(true)
    const second = await createBranch(holdingAdmin, clinic.id, branchInput({ name: "Second", slug }))
    expect(second).toEqual({ ok: false, error: "That URL slug is already taken." })
  })

  it("rejects a nonexistent clinic", async () => {
    const result = await createBranch(holdingAdmin, "00000000-0000-0000-0000-000000000000", branchInput())
    expect(result).toEqual({ ok: false, error: "Clinic not found." })
  })

  it("refuses every mutation for a clinic admin, without touching the database", async () => {
    const denied = { ok: false, error: "Only a holding admin manages branches." }

    const created = await createBranch(clinicAdmin, clinic.id, branchInput({ name: "Sneaky Branch" }))
    expect(created).toEqual(denied)

    const edit: EditBranchInput = {
      name: "Hijacked",
      address: "x",
      city: "x",
      phone: "0",
      facebookPageUrl: "",
      timezone: "Asia/Manila",
      operatingHours: STANDARD_HOURS,
    }
    expect(await updateBranch(clinicAdmin, existingBranch.id, edit)).toEqual(denied)
    expect(await setBranchActive(clinicAdmin, existingBranch.id, false)).toEqual(denied)

    const untouched = await superuserPrisma.branch.findUniqueOrThrow({ where: { id: existingBranch.id } })
    expect(untouched.name).toBe("AAA Existing Branch")
    expect(untouched.isActive).toBe(true)
  })

  it("lists branches for a holding admin, active and inactive, by name; filters by clinic", async () => {
    const inactive = await createBranch(holdingAdmin, clinic.id, branchInput({ name: "ZZZ Dormant Branch" }))
    expect(inactive.ok).toBe(true)
    if (!inactive.ok) return
    expect(await setBranchActive(holdingAdmin, inactive.branch.id, false)).toEqual({ ok: true })

    const otherBranch = await createBranch(holdingAdmin, otherClinic.id, branchInput({ name: "Branch In Other Clinic" }))
    expect(otherBranch.ok).toBe(true)
    if (!otherBranch.ok) return

    const all = await listBranches(holdingAdmin)
    expect(all.some((r) => r.id === existingBranch.id)).toBe(true)
    expect(all.some((r) => r.id === otherBranch.branch.id)).toBe(true)
    const dormant = all.find((r) => r.id === inactive.branch.id)
    expect(dormant?.isActive).toBe(false)

    const scoped = await listBranches(holdingAdmin, { clinicId: clinic.id })
    expect(scoped.some((r) => r.id === existingBranch.id)).toBe(true)
    expect(scoped.some((r) => r.id === otherBranch.branch.id)).toBe(false)

    // Ordered by name — asserted between two fixtures this suite owns, so
    // branches other test files create concurrently can't affect it.
    const names = scoped.map((r) => r.name)
    expect(names.indexOf("AAA Existing Branch")).toBeLessThan(names.indexOf("ZZZ Dormant Branch"))
  })

  it("throws rather than returning an empty list to a clinic admin", async () => {
    // §4.2: a forbidden read fails as a 403-equivalent. An empty list would
    // render as a plausible "No branches yet." and hide a broken gate.
    await expect(listBranches(clinicAdmin)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("gets a branch by id for a holding admin, with its clinic name", async () => {
    const branch = await getBranchById(holdingAdmin, existingBranch.id)
    expect(branch?.name).toBe("AAA Existing Branch")
    expect(branch?.clinicName).toBe("Test Clinic")
    expect(branch?.operatingHours.sun).toBeNull()
    expect(branch?.operatingHours.mon).toEqual({ open: "09:00", close: "18:00" })
  })

  it("throws for a clinic admin, and returns null only for an unknown id", async () => {
    await expect(getBranchById(clinicAdmin, existingBranch.id)).rejects.toBeInstanceOf(ForbiddenError)
    expect(await getBranchById(holdingAdmin, "00000000-0000-0000-0000-000000000000")).toBeNull()
  })

  it("updates the editable fields, leaves the slug alone, and audit-logs it", async () => {
    const created = await createBranch(holdingAdmin, clinic.id, branchInput({ name: "Before Rename" }))
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const originalSlug = created.branch.slug

    const result = await updateBranch(holdingAdmin, created.branch.id, {
      name: "After Rename",
      address: "22 Renamed Rd",
      city: "Renamed City",
      phone: "+63 911 111 1111",
      facebookPageUrl: "",
      timezone: "Asia/Manila",
      operatingHours: { ...STANDARD_HOURS, sat: null },
    })
    expect(result).toEqual({ ok: true })

    const row = await superuserPrisma.branch.findUniqueOrThrow({ where: { id: created.branch.id } })
    expect(row.name).toBe("After Rename")
    expect(row.address).toBe("22 Renamed Rd")
    expect(row.slug).toBe(originalSlug)

    const reread = await getBranchById(holdingAdmin, created.branch.id)
    expect(reread?.operatingHours.sat).toBeNull()

    const log = await superuserPrisma.auditLog.findFirst({
      where: { entityType: "Branch", entityId: created.branch.id, action: "branch.updated" },
    })
    expect(log).toBeTruthy()
  })

  it("reports a missing branch rather than throwing", async () => {
    const missing = "00000000-0000-0000-0000-000000000000"
    const edit: EditBranchInput = {
      name: "Ghost",
      address: "x",
      city: "x",
      phone: "0",
      facebookPageUrl: "",
      timezone: "Asia/Manila",
      operatingHours: STANDARD_HOURS,
    }
    expect(await updateBranch(holdingAdmin, missing, edit)).toEqual({ ok: false, error: "Branch not found." })
    expect(await setBranchActive(holdingAdmin, missing, false)).toEqual({ ok: false, error: "Branch not found." })
  })

  it("deactivates then reactivates a branch, audit-logging each", async () => {
    const created = await createBranch(holdingAdmin, clinic.id, branchInput({ name: "Toggle Branch" }))
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const id = created.branch.id

    expect(await setBranchActive(holdingAdmin, id, false)).toEqual({ ok: true })
    expect((await superuserPrisma.branch.findUniqueOrThrow({ where: { id } })).isActive).toBe(false)

    expect(await setBranchActive(holdingAdmin, id, true)).toEqual({ ok: true })
    expect((await superuserPrisma.branch.findUniqueOrThrow({ where: { id } })).isActive).toBe(true)

    const logs = await superuserPrisma.auditLog.findMany({
      where: { entityId: id, action: { in: ["branch.deactivated", "branch.reactivated"] } },
    })
    expect(logs.length).toBe(2)
  })

  describe("own-branch settings (clinic admin self-service)", () => {
    const settings: BranchSettingsInput = {
      address: "99 Moved Here St",
      city: "Relocated City",
      phone: "+63 900 111 2222",
      facebookPageUrl: "",
      operatingHours: { ...STANDARD_HOURS, sat: null },
    }

    it("returns the actor's own branch, resolved from the session and not a parameter", async () => {
      const branch = await getOwnBranch(clinicAdmin)
      expect(branch.id).toBe(existingBranch.id)
    })

    it("throws for a holding admin, who has no single branch of their own", async () => {
      await expect(getOwnBranch(holdingAdmin)).rejects.toBeInstanceOf(ForbiddenError)
    })

    it("updates the clinic admin's own branch and audit-logs it in the same transaction", async () => {
      expect(await updateOwnBranchSettings(clinicAdmin, settings)).toEqual({ ok: true })

      const row = await superuserPrisma.branch.findUniqueOrThrow({ where: { id: existingBranch.id } })
      expect(row.address).toBe("99 Moved Here St")
      expect(row.city).toBe("Relocated City")
      expect(row.phone).toBe("+63 900 111 2222")
      expect(row.facebookPageUrl).toBeNull()
      expect(row.operatingHours).toEqual({ ...STANDARD_HOURS, sat: null })

      // Only exists if the transaction ran through runWithRls — audit_logs
      // has an RLS policy even though branches doesn't.
      const log = await superuserPrisma.auditLog.findFirst({
        where: { entityType: "Branch", entityId: existingBranch.id, action: "branch.settings_updated" },
      })
      expect(log).toBeTruthy()
      expect(log!.userId).toBe(clinicAdmin.id)
    })

    it("cannot touch the privileged fields, even indirectly", async () => {
      const before = await superuserPrisma.branch.findUniqueOrThrow({ where: { id: existingBranch.id } })
      expect(await updateOwnBranchSettings(clinicAdmin, settings)).toEqual({ ok: true })
      const after = await superuserPrisma.branch.findUniqueOrThrow({ where: { id: existingBranch.id } })

      expect(after.name).toBe(before.name)
      expect(after.slug).toBe(before.slug)
      expect(after.timezone).toBe(before.timezone)
      expect(after.isActive).toBe(before.isActive)
      expect(after.clinicId).toBe(before.clinicId)
    })

    it("writes only to the actor's own branch, leaving every other branch untouched", async () => {
      const other = await createBranch(holdingAdmin, clinic.id, branchInput({ name: "Untouched Branch" }))
      expect(other.ok).toBe(true)
      if (!other.ok) return
      const before = await superuserPrisma.branch.findUniqueOrThrow({ where: { id: other.branch.id } })

      // There is no id parameter to point elsewhere — that's the point.
      expect(await updateOwnBranchSettings(clinicAdmin, settings)).toEqual({ ok: true })

      const after = await superuserPrisma.branch.findUniqueOrThrow({ where: { id: other.branch.id } })
      expect(after.address).toBe(before.address)
      expect(after.phone).toBe(before.phone)
      expect(after.operatingHours).toEqual(before.operatingHours)
    })

    it("refuses a holding admin, a front desk user, and a doctor", async () => {
      const denied = { ok: false, error: "Only a clinic admin manages their branch's settings." }
      expect(await updateOwnBranchSettings(holdingAdmin, settings)).toEqual(denied)

      const frontDesk: AbilitySubject = { ...clinicAdmin, role: Role.FRONT_DESK }
      const doctor: AbilitySubject = { ...clinicAdmin, role: Role.DOCTOR }
      expect(await updateOwnBranchSettings(frontDesk, settings)).toEqual(denied)
      expect(await updateOwnBranchSettings(doctor, settings)).toEqual(denied)
    })
  })
})
