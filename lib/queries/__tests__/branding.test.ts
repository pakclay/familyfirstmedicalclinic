import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { Role } from "@prisma/client"
import { superuserPrisma } from "@/lib/test/superuser-prisma"
import { prisma } from "@/lib/db/prisma"
import { getBrandName, updateBranding } from "@/lib/queries/branding"
import { editBrandingSchema } from "@/lib/validation/branding"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { ForbiddenError } from "@/lib/permissions/errors"

/**
 * The app-wide product name is a holding-admin setting. `holding_companies`
 * has no RLS policy (it is absent from enable_rls_backstop, same as
 * `clinics`), so the role check inside lib/queries/branding.ts *is* the
 * enforcement — there is no database backstop underneath it to catch a
 * regression here, which is exactly why it is worth a test of its own.
 */
describe("app branding", () => {
  let holding: { id: string }
  let clinic: { id: string }
  let branch: { id: string }
  let holdingAdmin: AbilitySubject
  let clinicAdmin: AbilitySubject

  beforeAll(async () => {
    holding = await superuserPrisma.holdingCompany.create({ data: { name: "Test Holding — branding" } })
    clinic = await superuserPrisma.clinic.create({
      data: { holdingCompanyId: holding.id, name: "Branding Test Clinic" },
    })
    branch = await superuserPrisma.branch.create({
      data: {
        clinicId: clinic.id,
        name: "Branding Test Branch",
        slug: `branding-branch-${Date.now()}`,
        address: "1 Test St",
        city: "Test City",
        phone: "0000",
        operatingHours: {},
      },
    })

    const holdingUser = await superuserPrisma.user.create({
      data: {
        holdingCompanyId: holding.id,
        name: "Holding Owner",
        email: `owner-branding-${Date.now()}@test.local`,
        passwordHash: "x",
        role: Role.HOLDING_ADMIN,
      },
    })
    holdingAdmin = { id: holdingUser.id, role: Role.HOLDING_ADMIN, branchId: null, holdingCompanyId: holding.id }

    const adminUser = await superuserPrisma.user.create({
      data: {
        branchId: branch.id,
        name: "Clinic Admin",
        email: `admin-branding-${Date.now()}@test.local`,
        passwordHash: "x",
        role: Role.CLINIC_ADMIN,
      },
    })
    clinicAdmin = { id: adminUser.id, role: Role.CLINIC_ADMIN, branchId: branch.id, holdingCompanyId: null }
  })

  afterAll(async () => {
    await superuserPrisma.auditLog.deleteMany({ where: { entityId: holding.id } })
    await superuserPrisma.user.deleteMany({ where: { branchId: branch.id } })
    await superuserPrisma.user.deleteMany({ where: { holdingCompanyId: holding.id } })
    await superuserPrisma.branch.deleteMany({ where: { id: branch.id } })
    await superuserPrisma.clinic.deleteMany({ where: { id: clinic.id } })
    await superuserPrisma.holdingCompany.deleteMany({ where: { id: holding.id } })
    await superuserPrisma.$disconnect()
    await prisma.$disconnect()
  })

  it("lets a holding admin set the app name, and audit-logs it in the same transaction", async () => {
    const result = await updateBranding(holdingAdmin, { brandName: "Sunrise Health Clinic" })
    expect(result.ok).toBe(true)

    const row = await superuserPrisma.holdingCompany.findUniqueOrThrow({ where: { id: holding.id } })
    expect(row.brandName).toBe("Sunrise Health Clinic")
    // The legal-entity name is a different field and must not move with it.
    expect(row.name).toBe("Test Holding — branding")

    // `audit_logs` has an RLS policy, so this row only exists if the write
    // went through runWithRls with the app.role/app.user_id GUCs set.
    const log = await superuserPrisma.auditLog.findFirst({
      where: { entityType: "HoldingCompany", entityId: holding.id, action: "holding_company.brand_updated" },
    })
    expect(log).not.toBeNull()
    expect(log?.userId).toBe(holdingAdmin.id)
  })

  it("stores null rather than an empty string when the name is cleared, so the built-in default comes back", async () => {
    await updateBranding(holdingAdmin, { brandName: "Something Else" })

    // Goes through the schema the action uses, because turning "" into null
    // is the schema's job — asserting on a hand-written null would test the
    // query in a way the real call path never exercises.
    const parsed = editBrandingSchema.parse({ brandName: "   " })
    expect(parsed.brandName).toBeNull()

    const result = await updateBranding(holdingAdmin, parsed)
    expect(result.ok).toBe(true)

    const row = await superuserPrisma.holdingCompany.findUniqueOrThrow({ where: { id: holding.id } })
    expect(row.brandName).toBeNull()
  })

  it("refuses a clinic admin, and leaves the stored name untouched", async () => {
    await updateBranding(holdingAdmin, { brandName: "Set By Holding Admin" })

    const result = await updateBranding(clinicAdmin, { brandName: "Set By Clinic Admin" })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/holding admin/i)

    const row = await superuserPrisma.holdingCompany.findUniqueOrThrow({ where: { id: holding.id } })
    expect(row.brandName).toBe("Set By Holding Admin")
  })

  it("throws rather than returning null when a clinic admin reads the name", async () => {
    // Same shape as the other holding-admin-only reads (§4.2): a role denial
    // fails loudly instead of degrading into a plausible "not set".
    await expect(getBrandName(clinicAdmin)).rejects.toBeInstanceOf(ForbiddenError)
  })
})
