import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { Role } from "@prisma/client"
import { superuserPrisma } from "@/lib/test/superuser-prisma"
import { prisma } from "@/lib/db/prisma"
import { listClinics, getClinicById, createClinic, updateClinic } from "@/lib/queries/clinics"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { ForbiddenError } from "@/lib/permissions/errors"
import type { CreateClinicInput, EditClinicInput } from "@/lib/validation/clinic"

function clinicInput(overrides: Partial<CreateClinicInput> = {}): CreateClinicInput {
  return { name: "New Clinic", ...overrides }
}

describe("clinic management", () => {
  let holding: { id: string }
  let existingClinic: { id: string }
  let existingBranch: { id: string }
  let holdingAdmin: AbilitySubject
  let clinicAdmin: AbilitySubject

  beforeAll(async () => {
    holding = await superuserPrisma.holdingCompany.create({ data: { name: "Test Holding — clinic mgmt" } })
    existingClinic = await superuserPrisma.clinic.create({
      data: { holdingCompanyId: holding.id, name: "AAA Existing Clinic" },
    })
    // Clinic is purely organizational after the branch-hierarchy migration
    // (see DECISIONS.md) — a CLINIC_ADMIN's AbilitySubject needs a real
    // branchId, so this fixture exists purely to give clinicAdmin somewhere
    // to belong; none of this file's tests exercise Branch behavior itself
    // (that's lib/queries/__tests__/branches.test.ts).
    existingBranch = await superuserPrisma.branch.create({
      data: {
        clinicId: existingClinic.id,
        name: "Existing Branch",
        slug: `existing-branch-${Date.now()}`,
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
        email: `owner-clinics-${Date.now()}@test.local`,
        passwordHash: "x",
        role: Role.HOLDING_ADMIN,
      },
    })
    holdingAdmin = { id: holdingUser.id, role: Role.HOLDING_ADMIN, branchId: null, holdingCompanyId: holding.id }

    const adminUser = await superuserPrisma.user.create({
      data: {
        branchId: existingBranch.id,
        name: "Clinic Admin",
        email: `admin-clinics-${Date.now()}@test.local`,
        passwordHash: "x",
        role: Role.CLINIC_ADMIN,
      },
    })
    clinicAdmin = { id: adminUser.id, role: Role.CLINIC_ADMIN, branchId: existingBranch.id, holdingCompanyId: null }
  })

  afterAll(async () => {
    // Everything this suite creates hangs off the one holding company —
    // including clinics createClinic made itself, which is why the ids are
    // re-read here rather than tracked by hand.
    const clinics = await superuserPrisma.clinic.findMany({
      where: { holdingCompanyId: holding.id },
      select: { id: true },
    })
    const clinicIds = clinics.map((c) => c.id)
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

  it("lets a holding admin create a clinic, and audit-logs it in the same transaction", async () => {
    const input = clinicInput({ name: "Makati Clinic" })
    const result = await createClinic(holdingAdmin, input)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.clinic.name).toBe("Makati Clinic")

    const row = await superuserPrisma.clinic.findUniqueOrThrow({ where: { id: result.clinic.id } })
    expect(row.holdingCompanyId).toBe(holding.id)

    // `audit_logs` *does* have an RLS policy (unlike `clinics`), so this
    // row only exists if the whole transaction ran through runWithRls with
    // the app.role/app.user_id GUCs set.
    const log = await superuserPrisma.auditLog.findFirst({
      where: { entityType: "Clinic", entityId: result.clinic.id, action: "clinic.created" },
    })
    expect(log).toBeTruthy()
    expect(log!.userId).toBe(holdingAdmin.id)
    expect(log!.changes).toEqual({ name: "Makati Clinic" })
  })

  it("refuses every mutation for a clinic admin, without touching the database", async () => {
    const denied = { ok: false, error: "Only a holding admin manages clinics." }

    const created = await createClinic(clinicAdmin, clinicInput({ name: "Sneaky Clinic" }))
    expect(created).toEqual(denied)

    const edit: EditClinicInput = { name: "Hijacked" }
    expect(await updateClinic(clinicAdmin, existingClinic.id, edit)).toEqual(denied)

    const untouched = await superuserPrisma.clinic.findUniqueOrThrow({ where: { id: existingClinic.id } })
    expect(untouched.name).toBe("AAA Existing Clinic")
  })

  it("lists every clinic for a holding admin, by name", async () => {
    const created = await createClinic(holdingAdmin, clinicInput({ name: "ZZZ Another Clinic" }))
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const rows = await listClinics(holdingAdmin)
    expect(rows.some((r) => r.id === existingClinic.id)).toBe(true)
    expect(rows.some((r) => r.id === created.clinic.id)).toBe(true)

    // Ordered by name — asserted between two fixtures this suite owns, so
    // clinics other test files create concurrently can't affect it.
    const names = rows.map((r) => r.name)
    expect(names.indexOf("AAA Existing Clinic")).toBeLessThan(names.indexOf("ZZZ Another Clinic"))
  })

  it("throws rather than returning an empty list to a clinic admin", async () => {
    // §4.2: a forbidden read fails as a 403-equivalent. An empty list would
    // render as a plausible "No clinics yet." and hide a broken gate.
    await expect(listClinics(clinicAdmin)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("gets a clinic by id for a holding admin", async () => {
    const clinic = await getClinicById(holdingAdmin, existingClinic.id)
    expect(clinic?.name).toBe("AAA Existing Clinic")
  })

  it("throws for a clinic admin, and returns null only for an unknown id", async () => {
    await expect(getClinicById(clinicAdmin, existingClinic.id)).rejects.toBeInstanceOf(ForbiddenError)
    expect(await getClinicById(holdingAdmin, "00000000-0000-0000-0000-000000000000")).toBeNull()
  })

  it("updates the name, and audit-logs it", async () => {
    const created = await createClinic(holdingAdmin, clinicInput({ name: "Before Rename" }))
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const result = await updateClinic(holdingAdmin, created.clinic.id, { name: "After Rename" })
    expect(result).toEqual({ ok: true })

    const row = await superuserPrisma.clinic.findUniqueOrThrow({ where: { id: created.clinic.id } })
    expect(row.name).toBe("After Rename")

    const log = await superuserPrisma.auditLog.findFirst({
      where: { entityType: "Clinic", entityId: created.clinic.id, action: "clinic.updated" },
    })
    expect(log).toBeTruthy()
  })

  it("reports a missing clinic rather than throwing", async () => {
    const missing = "00000000-0000-0000-0000-000000000000"
    expect(await updateClinic(holdingAdmin, missing, { name: "Ghost" })).toEqual({ ok: false, error: "Clinic not found." })
  })
})
