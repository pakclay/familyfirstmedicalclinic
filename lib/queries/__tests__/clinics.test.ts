import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { Role } from "@prisma/client"
import { superuserPrisma } from "@/lib/test/superuser-prisma"
import { prisma } from "@/lib/db/prisma"
import {
  listClinics,
  getClinicById,
  createClinic,
  updateClinic,
  setClinicActive,
  getOwnClinic,
  updateOwnClinicSettings,
} from "@/lib/queries/clinics"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { ForbiddenError } from "@/lib/permissions/errors"
import type {
  ClinicSettingsInput,
  CreateClinicInput,
  EditClinicInput,
  OperatingHours,
} from "@/lib/validation/clinic"

const STANDARD_HOURS: OperatingHours = {
  mon: { open: "09:00", close: "18:00" },
  tue: { open: "09:00", close: "18:00" },
  wed: { open: "09:00", close: "18:00" },
  thu: { open: "09:00", close: "18:00" },
  fri: { open: "09:00", close: "18:00" },
  sat: { open: "08:00", close: "12:00" },
  sun: null,
}

function clinicInput(overrides: Partial<CreateClinicInput> = {}): CreateClinicInput {
  return {
    name: "New Clinic",
    slug: `new-clinic-${Date.now()}-${Math.floor(Math.random() * 10_000)}`,
    address: "10 Test Ave",
    city: "Test City",
    phone: "+63 900 000 0000",
    facebookPageUrl: "",
    timezone: "Asia/Manila",
    operatingHours: STANDARD_HOURS,
    ...overrides,
  }
}

describe("clinic management", () => {
  let holding: { id: string }
  let existingClinic: { id: string }
  let holdingAdmin: AbilitySubject
  let clinicAdmin: AbilitySubject

  beforeAll(async () => {
    holding = await superuserPrisma.holdingCompany.create({ data: { name: "Test Holding — clinic mgmt" } })
    existingClinic = await superuserPrisma.clinic.create({
      data: {
        holdingCompanyId: holding.id,
        name: "AAA Existing Clinic",
        slug: `existing-clinic-${Date.now()}`,
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
        email: `owner-clinics-${Date.now()}@test.local`,
        passwordHash: "x",
        role: Role.HOLDING_ADMIN,
      },
    })
    holdingAdmin = { id: holdingUser.id, role: Role.HOLDING_ADMIN, clinicId: null, holdingCompanyId: holding.id }

    const adminUser = await superuserPrisma.user.create({
      data: {
        clinicId: existingClinic.id,
        name: "Clinic Admin",
        email: `admin-clinics-${Date.now()}@test.local`,
        passwordHash: "x",
        role: Role.CLINIC_ADMIN,
      },
    })
    clinicAdmin = { id: adminUser.id, role: Role.CLINIC_ADMIN, clinicId: existingClinic.id, holdingCompanyId: null }
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
    await superuserPrisma.auditLog.deleteMany({ where: { clinicId: { in: clinicIds } } })
    await superuserPrisma.user.deleteMany({ where: { clinicId: { in: clinicIds } } })
    await superuserPrisma.user.deleteMany({ where: { holdingCompanyId: holding.id } })
    await superuserPrisma.clinic.deleteMany({ where: { id: { in: clinicIds } } })
    await superuserPrisma.holdingCompany.deleteMany({ where: { id: holding.id } })
    await superuserPrisma.$disconnect()
    await prisma.$disconnect()
  })

  it("lets a holding admin create a clinic, and audit-logs it in the same transaction", async () => {
    const input = clinicInput({ name: "Makati Branch", facebookPageUrl: "https://facebook.com/familyfirst.makati" })
    const result = await createClinic(holdingAdmin, input)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.clinic.name).toBe("Makati Branch")
    expect(result.clinic.slug).toBe(input.slug)
    expect(result.clinic.isActive).toBe(true)
    expect(result.clinic.facebookPageUrl).toBe("https://facebook.com/familyfirst.makati")
    expect(result.clinic.operatingHours).toEqual(STANDARD_HOURS)

    const row = await superuserPrisma.clinic.findUniqueOrThrow({ where: { id: result.clinic.id } })
    expect(row.holdingCompanyId).toBe(holding.id)
    expect(row.timezone).toBe("Asia/Manila")

    // `audit_logs` *does* have an RLS policy (unlike `clinics`), so this
    // row only exists if the whole transaction ran through runWithRls with
    // the app.role/app.user_id GUCs set.
    const log = await superuserPrisma.auditLog.findFirst({
      where: { entityType: "Clinic", entityId: result.clinic.id, action: "clinic.created" },
    })
    expect(log).toBeTruthy()
    expect(log!.userId).toBe(holdingAdmin.id)
    expect(log!.changes).toEqual({ name: "Makati Branch", slug: input.slug })
  })

  it("stores an empty Facebook URL as null", async () => {
    const result = await createClinic(holdingAdmin, clinicInput({ name: "No Facebook Branch" }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.clinic.facebookPageUrl).toBeNull()
  })

  it("rejects a duplicate slug", async () => {
    const slug = `dupe-clinic-${Date.now()}`
    const first = await createClinic(holdingAdmin, clinicInput({ name: "First", slug }))
    expect(first.ok).toBe(true)
    const second = await createClinic(holdingAdmin, clinicInput({ name: "Second", slug }))
    expect(second).toEqual({ ok: false, error: "That URL slug is already taken." })
  })

  it("refuses every mutation for a clinic admin, without touching the database", async () => {
    const denied = { ok: false, error: "Only a holding admin manages clinics." }

    const created = await createClinic(clinicAdmin, clinicInput({ name: "Sneaky Clinic", slug: `sneaky-${Date.now()}` }))
    expect(created).toEqual(denied)

    const edit: EditClinicInput = {
      name: "Hijacked",
      address: "x",
      city: "x",
      phone: "0",
      facebookPageUrl: "",
      timezone: "Asia/Manila",
      operatingHours: STANDARD_HOURS,
    }
    expect(await updateClinic(clinicAdmin, existingClinic.id, edit)).toEqual(denied)
    expect(await setClinicActive(clinicAdmin, existingClinic.id, false)).toEqual(denied)

    const untouched = await superuserPrisma.clinic.findUniqueOrThrow({ where: { id: existingClinic.id } })
    expect(untouched.name).toBe("AAA Existing Clinic")
    expect(untouched.isActive).toBe(true)
  })

  it("lists every clinic for a holding admin, active and inactive, by name", async () => {
    const inactive = await createClinic(holdingAdmin, clinicInput({ name: "ZZZ Dormant Branch" }))
    expect(inactive.ok).toBe(true)
    if (!inactive.ok) return
    expect(await setClinicActive(holdingAdmin, inactive.clinic.id, false)).toEqual({ ok: true })

    const rows = await listClinics(holdingAdmin)
    expect(rows.some((r) => r.id === existingClinic.id)).toBe(true)
    const dormant = rows.find((r) => r.id === inactive.clinic.id)
    expect(dormant?.isActive).toBe(false)

    // Ordered by name — asserted between two fixtures this suite owns, so
    // clinics other test files create concurrently can't affect it.
    const names = rows.map((r) => r.name)
    expect(names.indexOf("AAA Existing Clinic")).toBeLessThan(names.indexOf("ZZZ Dormant Branch"))
  })

  it("throws rather than returning an empty list to a clinic admin", async () => {
    // §4.2: a forbidden read fails as a 403-equivalent. An empty list would
    // render as a plausible "No clinics yet." and hide a broken gate.
    await expect(listClinics(clinicAdmin)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("gets a clinic by id for a holding admin", async () => {
    const clinic = await getClinicById(holdingAdmin, existingClinic.id)
    expect(clinic?.name).toBe("AAA Existing Clinic")
    expect(clinic?.operatingHours.sun).toBeNull()
    expect(clinic?.operatingHours.mon).toEqual({ open: "09:00", close: "18:00" })
  })

  it("throws for a clinic admin, and returns null only for an unknown id", async () => {
    await expect(getClinicById(clinicAdmin, existingClinic.id)).rejects.toBeInstanceOf(ForbiddenError)
    expect(await getClinicById(holdingAdmin, "00000000-0000-0000-0000-000000000000")).toBeNull()
  })

  it("updates the editable fields, leaves the slug alone, and audit-logs it", async () => {
    const created = await createClinic(holdingAdmin, clinicInput({ name: "Before Rename" }))
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const originalSlug = created.clinic.slug

    const result = await updateClinic(holdingAdmin, created.clinic.id, {
      name: "After Rename",
      address: "22 Renamed Rd",
      city: "Renamed City",
      phone: "+63 911 111 1111",
      facebookPageUrl: "",
      timezone: "Asia/Manila",
      operatingHours: { ...STANDARD_HOURS, sat: null },
    })
    expect(result).toEqual({ ok: true })

    const row = await superuserPrisma.clinic.findUniqueOrThrow({ where: { id: created.clinic.id } })
    expect(row.name).toBe("After Rename")
    expect(row.address).toBe("22 Renamed Rd")
    expect(row.slug).toBe(originalSlug)

    const reread = await getClinicById(holdingAdmin, created.clinic.id)
    expect(reread?.operatingHours.sat).toBeNull()

    const log = await superuserPrisma.auditLog.findFirst({
      where: { entityType: "Clinic", entityId: created.clinic.id, action: "clinic.updated" },
    })
    expect(log).toBeTruthy()
  })

  it("reports a missing clinic rather than throwing", async () => {
    const missing = "00000000-0000-0000-0000-000000000000"
    const edit: EditClinicInput = {
      name: "Ghost",
      address: "x",
      city: "x",
      phone: "0",
      facebookPageUrl: "",
      timezone: "Asia/Manila",
      operatingHours: STANDARD_HOURS,
    }
    expect(await updateClinic(holdingAdmin, missing, edit)).toEqual({ ok: false, error: "Clinic not found." })
    expect(await setClinicActive(holdingAdmin, missing, false)).toEqual({ ok: false, error: "Clinic not found." })
  })

  it("deactivates then reactivates a clinic, audit-logging each", async () => {
    const created = await createClinic(holdingAdmin, clinicInput({ name: "Toggle Branch" }))
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const id = created.clinic.id

    expect(await setClinicActive(holdingAdmin, id, false)).toEqual({ ok: true })
    expect((await superuserPrisma.clinic.findUniqueOrThrow({ where: { id } })).isActive).toBe(false)

    expect(await setClinicActive(holdingAdmin, id, true)).toEqual({ ok: true })
    expect((await superuserPrisma.clinic.findUniqueOrThrow({ where: { id } })).isActive).toBe(true)

    const logs = await superuserPrisma.auditLog.findMany({
      where: { entityId: id, action: { in: ["clinic.deactivated", "clinic.reactivated"] } },
    })
    expect(logs.length).toBe(2)
  })

  describe("own-clinic settings (clinic admin self-service)", () => {
    const settings: ClinicSettingsInput = {
      address: "99 Moved Here St",
      city: "Relocated City",
      phone: "+63 900 111 2222",
      facebookPageUrl: "",
      operatingHours: { ...STANDARD_HOURS, sat: null },
    }

    it("returns the actor's own clinic, resolved from the session and not a parameter", async () => {
      const clinic = await getOwnClinic(clinicAdmin)
      expect(clinic.id).toBe(existingClinic.id)
    })

    it("throws for a holding admin, who has no single clinic of their own", async () => {
      await expect(getOwnClinic(holdingAdmin)).rejects.toBeInstanceOf(ForbiddenError)
    })

    it("updates the clinic admin's own clinic and audit-logs it in the same transaction", async () => {
      expect(await updateOwnClinicSettings(clinicAdmin, settings)).toEqual({ ok: true })

      const row = await superuserPrisma.clinic.findUniqueOrThrow({ where: { id: existingClinic.id } })
      expect(row.address).toBe("99 Moved Here St")
      expect(row.city).toBe("Relocated City")
      expect(row.phone).toBe("+63 900 111 2222")
      expect(row.facebookPageUrl).toBeNull()
      expect(row.operatingHours).toEqual({ ...STANDARD_HOURS, sat: null })

      // Only exists if the transaction ran through runWithRls — audit_logs
      // has an RLS policy even though clinics doesn't.
      const log = await superuserPrisma.auditLog.findFirst({
        where: { entityType: "Clinic", entityId: existingClinic.id, action: "clinic.settings_updated" },
      })
      expect(log).toBeTruthy()
      expect(log!.userId).toBe(clinicAdmin.id)
    })

    it("cannot touch the privileged fields, even indirectly", async () => {
      const before = await superuserPrisma.clinic.findUniqueOrThrow({ where: { id: existingClinic.id } })
      expect(await updateOwnClinicSettings(clinicAdmin, settings)).toEqual({ ok: true })
      const after = await superuserPrisma.clinic.findUniqueOrThrow({ where: { id: existingClinic.id } })

      expect(after.name).toBe(before.name)
      expect(after.slug).toBe(before.slug)
      expect(after.timezone).toBe(before.timezone)
      expect(after.isActive).toBe(before.isActive)
      expect(after.holdingCompanyId).toBe(before.holdingCompanyId)
    })

    it("writes only to the actor's own clinic, leaving every other clinic untouched", async () => {
      const other = await createClinic(holdingAdmin, clinicInput({ name: "Untouched Branch" }))
      expect(other.ok).toBe(true)
      if (!other.ok) return
      const before = await superuserPrisma.clinic.findUniqueOrThrow({ where: { id: other.clinic.id } })

      // There is no id parameter to point elsewhere — that's the point.
      expect(await updateOwnClinicSettings(clinicAdmin, settings)).toEqual({ ok: true })

      const after = await superuserPrisma.clinic.findUniqueOrThrow({ where: { id: other.clinic.id } })
      expect(after.address).toBe(before.address)
      expect(after.phone).toBe(before.phone)
      expect(after.operatingHours).toEqual(before.operatingHours)
    })

    it("refuses a holding admin, a front desk user, and a doctor", async () => {
      const denied = { ok: false, error: "Only a clinic admin manages their clinic's settings." }
      expect(await updateOwnClinicSettings(holdingAdmin, settings)).toEqual(denied)

      const frontDesk: AbilitySubject = { ...clinicAdmin, role: Role.FRONT_DESK }
      const doctor: AbilitySubject = { ...clinicAdmin, role: Role.DOCTOR }
      expect(await updateOwnClinicSettings(frontDesk, settings)).toEqual(denied)
      expect(await updateOwnClinicSettings(doctor, settings)).toEqual(denied)
    })
  })
})
