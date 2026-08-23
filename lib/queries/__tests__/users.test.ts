import { afterAll, beforeAll, describe, expect, it } from "vitest"
import bcrypt from "bcryptjs"
import { Role } from "@prisma/client"
import { superuserPrisma } from "@/lib/test/superuser-prisma"
import { prisma } from "@/lib/db/prisma"
import {
  isLockedOut,
  recordFailedLogin,
  recordSuccessfulLogin,
  changeOwnPassword,
  generateTempPassword,
  listUsers,
  getManagedUserById,
  createUser,
  updateUser,
  setUserActive,
  forcePasswordReset,
  unlockAccount,
  LOGIN_LOCKOUT_THRESHOLD,
  LOGIN_LOCKOUT_DURATION_MINUTES,
} from "@/lib/queries/users"
import type { AbilitySubject } from "@/lib/permissions/ability"

describe("isLockedOut", () => {
  it("is false with no lockedUntil", () => {
    expect(isLockedOut({ lockedUntil: null })).toBe(false)
  })

  it("is true while lockedUntil is in the future", () => {
    expect(isLockedOut({ lockedUntil: new Date(Date.now() + 60_000) })).toBe(true)
  })

  it("is false once lockedUntil is in the past", () => {
    expect(isLockedOut({ lockedUntil: new Date(Date.now() - 60_000) })).toBe(false)
  })
})

describe("login lockout and password change", () => {
  let holding: { id: string }
  let clinic: { id: string }
  let user: { id: string }
  let subject: AbilitySubject
  const CURRENT_PASSWORD = "InitialPass123"

  beforeAll(async () => {
    holding = await superuserPrisma.holdingCompany.create({
      data: { name: "Test Holding — users" },
    })
    clinic = await superuserPrisma.clinic.create({
      data: {
        holdingCompanyId: holding.id,
        name: "Clinic Users",
        slug: `clinic-users-${Date.now()}`,
        address: "1 Test St",
        city: "Test City",
        phone: "0000",
        operatingHours: {},
      },
    })
    user = await superuserPrisma.user.create({
      data: {
        clinicId: clinic.id,
        name: "Lockout Test User",
        email: `lockout-${Date.now()}@test.local`,
        passwordHash: await bcrypt.hash(CURRENT_PASSWORD, 10),
        role: Role.FRONT_DESK,
        mustChangePassword: true,
      },
    })
    subject = { id: user.id, role: Role.FRONT_DESK, clinicId: clinic.id, holdingCompanyId: null }
  })

  afterAll(async () => {
    await superuserPrisma.auditLog.deleteMany({ where: { clinicId: clinic.id } })
    await superuserPrisma.user.deleteMany({ where: { clinicId: clinic.id } })
    await superuserPrisma.clinic.deleteMany({ where: { id: clinic.id } })
    await superuserPrisma.holdingCompany.deleteMany({ where: { id: holding.id } })
    await superuserPrisma.$disconnect()
    await prisma.$disconnect()
  })

  it(`locks the account after ${LOGIN_LOCKOUT_THRESHOLD} failed attempts, for ${LOGIN_LOCKOUT_DURATION_MINUTES} minutes`, async () => {
    let current = 0
    for (let i = 0; i < LOGIN_LOCKOUT_THRESHOLD - 1; i++) {
      await recordFailedLogin(user.id, current)
      const row = await superuserPrisma.user.findUniqueOrThrow({ where: { id: user.id } })
      current = row.failedLoginAttempts
      expect(current).toBe(i + 1)
      expect(row.lockedUntil).toBeNull()
    }

    await recordFailedLogin(user.id, current)
    const locked = await superuserPrisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(locked.failedLoginAttempts).toBe(0)
    expect(locked.lockedUntil).not.toBeNull()
    expect(isLockedOut(locked)).toBe(true)
    expect(locked.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + (LOGIN_LOCKOUT_DURATION_MINUTES - 1) * 60_000)
  })

  it("clears the lockout on a successful login", async () => {
    await recordSuccessfulLogin(user.id)
    const row = await superuserPrisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(row.failedLoginAttempts).toBe(0)
    expect(row.lockedUntil).toBeNull()
  })

  it("rejects a password change with the wrong current password", async () => {
    const result = await changeOwnPassword(subject, "WrongPassword123", "BrandNewPass456")
    expect(result).toEqual({ ok: false, error: "Current password is incorrect." })
  })

  it("rejects a new password identical to the current one", async () => {
    const result = await changeOwnPassword(subject, CURRENT_PASSWORD, CURRENT_PASSWORD)
    expect(result).toEqual({
      ok: false,
      error: "New password must be different from your current password.",
    })
  })

  it("changes the password, clears mustChangePassword, and audit-logs it", async () => {
    const result = await changeOwnPassword(subject, CURRENT_PASSWORD, "BrandNewPass456")
    expect(result).toEqual({ ok: true })

    const row = await superuserPrisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(row.mustChangePassword).toBe(false)
    expect(await bcrypt.compare("BrandNewPass456", row.passwordHash)).toBe(true)
    expect(await bcrypt.compare(CURRENT_PASSWORD, row.passwordHash)).toBe(false)

    const log = await superuserPrisma.auditLog.findFirst({
      where: { entityId: user.id, action: "user.password_changed", userId: user.id },
    })
    expect(log).toBeTruthy()
  })
})

describe("generateTempPassword", () => {
  it("always satisfies the password policy (10+ chars, a letter, a number)", () => {
    for (let i = 0; i < 20; i++) {
      const pw = generateTempPassword()
      expect(pw.length).toBeGreaterThanOrEqual(10)
      expect(pw).toMatch(/[A-Za-z]/)
      expect(pw).toMatch(/\d/)
    }
  })
})

describe("user management", () => {
  let holding: { id: string }
  let clinicA: { id: string }
  let clinicB: { id: string }
  let clinicAdminA: AbilitySubject
  let holdingAdmin: AbilitySubject
  let frontDeskInA: { id: string }
  let frontDeskInB: { id: string }

  beforeAll(async () => {
    holding = await superuserPrisma.holdingCompany.create({ data: { name: "Test Holding — user mgmt" } })
    clinicA = await superuserPrisma.clinic.create({
      data: {
        holdingCompanyId: holding.id,
        name: "Clinic A",
        slug: `clinic-mgmt-a-${Date.now()}`,
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
        slug: `clinic-mgmt-b-${Date.now()}`,
        address: "2 Test St",
        city: "Test City",
        phone: "0000",
        operatingHours: {},
      },
    })

    const adminUser = await superuserPrisma.user.create({
      data: {
        clinicId: clinicA.id,
        name: "Clinic A Admin",
        email: `admin-a-${Date.now()}@test.local`,
        passwordHash: "x",
        role: Role.CLINIC_ADMIN,
      },
    })
    clinicAdminA = { id: adminUser.id, role: Role.CLINIC_ADMIN, clinicId: clinicA.id, holdingCompanyId: null }

    const holdingUser = await superuserPrisma.user.create({
      data: {
        holdingCompanyId: holding.id,
        name: "Holding Owner",
        email: `owner-mgmt-${Date.now()}@test.local`,
        passwordHash: "x",
        role: Role.HOLDING_ADMIN,
      },
    })
    holdingAdmin = { id: holdingUser.id, role: Role.HOLDING_ADMIN, clinicId: null, holdingCompanyId: holding.id }

    const fdA = await superuserPrisma.user.create({
      data: {
        clinicId: clinicA.id,
        name: "Front Desk A",
        email: `fd-a-${Date.now()}@test.local`,
        passwordHash: "x",
        role: Role.FRONT_DESK,
      },
    })
    frontDeskInA = { id: fdA.id }

    const fdB = await superuserPrisma.user.create({
      data: {
        clinicId: clinicB.id,
        name: "Front Desk B",
        email: `fd-b-${Date.now()}@test.local`,
        passwordHash: "x",
        role: Role.FRONT_DESK,
      },
    })
    frontDeskInB = { id: fdB.id }
  })

  afterAll(async () => {
    await superuserPrisma.auditLog.deleteMany({ where: { clinicId: { in: [clinicA.id, clinicB.id] } } })
    await superuserPrisma.doctor.deleteMany({ where: { clinicId: { in: [clinicA.id, clinicB.id] } } })
    await superuserPrisma.user.deleteMany({ where: { clinicId: { in: [clinicA.id, clinicB.id] } } })
    await superuserPrisma.user.delete({ where: { id: holdingAdmin.id } })
    await superuserPrisma.clinic.deleteMany({ where: { id: { in: [clinicA.id, clinicB.id] } } })
    await superuserPrisma.holdingCompany.deleteMany({ where: { id: holding.id } })
    await superuserPrisma.$disconnect()
    await prisma.$disconnect()
  })

  it("lets a clinic admin create a front desk account in their own clinic", async () => {
    const result = await createUser(clinicAdminA, {
      name: "New Staff",
      email: `new-staff-${Date.now()}@test.local`,
      role: "FRONT_DESK",
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.user.clinicId).toBe(clinicA.id)
    expect(result.user.mustChangePassword).toBe(true)
    expect(result.tempPassword.length).toBeGreaterThanOrEqual(10)

    const log = await superuserPrisma.auditLog.findFirst({
      where: { entityId: result.user.id, action: "user.created" },
    })
    expect(log).toBeTruthy()
  })

  it("blocks a clinic admin from creating a clinic admin account", async () => {
    const result = await createUser(clinicAdminA, {
      name: "Sneaky Admin",
      email: `sneaky-${Date.now()}@test.local`,
      role: "CLINIC_ADMIN",
    })
    expect(result).toEqual({ ok: false, error: "You can't create an account with that role." })
  })

  it("ignores a clinic admin's attempt to assign a user to a different clinic", async () => {
    const result = await createUser(clinicAdminA, {
      name: "Should Be In A",
      email: `should-be-a-${Date.now()}@test.local`,
      role: "FRONT_DESK",
      clinicId: clinicB.id, // attacker-supplied — must be ignored
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.user.clinicId).toBe(clinicA.id)
  })

  it("lets a holding admin create a doctor in any clinic, with the paired Doctor row", async () => {
    const result = await createUser(holdingAdmin, {
      name: "Dr. New",
      email: `dr-new-${Date.now()}@test.local`,
      role: "DOCTOR",
      clinicId: clinicB.id,
      licenseNumber: "LIC-999",
      consultationFeePesos: "500",
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.user.clinicId).toBe(clinicB.id)
    expect(result.user.doctor).toEqual({
      licenseNumber: "LIC-999",
      specialization: "General Practitioner",
      consultationFeePesos: 500,
    })
  })

  it("rejects a duplicate email", async () => {
    const email = `dupe-${Date.now()}@test.local`
    const first = await createUser(holdingAdmin, { name: "First", email, role: "FRONT_DESK", clinicId: clinicA.id })
    expect(first.ok).toBe(true)
    const second = await createUser(holdingAdmin, { name: "Second", email, role: "FRONT_DESK", clinicId: clinicA.id })
    expect(second).toEqual({ ok: false, error: "An account with that email already exists." })
  })

  it("scopes listUsers to the clinic admin's own clinic, front desk/doctor only", async () => {
    const rows = await listUsers(clinicAdminA)
    expect(rows.some((r) => r.id === frontDeskInA.id)).toBe(true)
    expect(rows.some((r) => r.id === frontDeskInB.id)).toBe(false)
    expect(rows.every((r) => r.role === "FRONT_DESK" || r.role === "DOCTOR")).toBe(true)
  })

  it("lets a holding admin list users across every clinic", async () => {
    const rows = await listUsers(holdingAdmin)
    expect(rows.some((r) => r.id === frontDeskInA.id)).toBe(true)
    expect(rows.some((r) => r.id === frontDeskInB.id)).toBe(true)
  })

  it("returns null for a user outside the clinic admin's clinic — not an error, not a leak", async () => {
    const result = await getManagedUserById(clinicAdminA, frontDeskInB.id)
    expect(result).toBeNull()
  })

  it("lets a clinic admin update a front desk account in their clinic", async () => {
    const result = await updateUser(clinicAdminA, frontDeskInA.id, { name: "Front Desk A Renamed" })
    expect(result).toEqual({ ok: true })
    const row = await superuserPrisma.user.findUniqueOrThrow({ where: { id: frontDeskInA.id } })
    expect(row.name).toBe("Front Desk A Renamed")
  })

  it("blocks updating a user outside the clinic admin's clinic", async () => {
    const result = await updateUser(clinicAdminA, frontDeskInB.id, { name: "Hijacked" })
    expect(result).toEqual({ ok: false, error: "User not found." })
  })

  it("prevents an admin from deactivating their own account", async () => {
    const result = await setUserActive(clinicAdminA, clinicAdminA.id, false)
    expect(result).toEqual({ ok: false, error: "You can't deactivate your own account." })
  })

  it("deactivates and reactivates a managed account, audit-logging each", async () => {
    const off = await setUserActive(clinicAdminA, frontDeskInA.id, false)
    expect(off).toEqual({ ok: true })
    expect((await superuserPrisma.user.findUniqueOrThrow({ where: { id: frontDeskInA.id } })).isActive).toBe(false)

    const on = await setUserActive(clinicAdminA, frontDeskInA.id, true)
    expect(on).toEqual({ ok: true })
    expect((await superuserPrisma.user.findUniqueOrThrow({ where: { id: frontDeskInA.id } })).isActive).toBe(true)

    const logs = await superuserPrisma.auditLog.findMany({
      where: { entityId: frontDeskInA.id, action: { in: ["user.deactivated", "user.reactivated"] } },
    })
    expect(logs.length).toBe(2)
  })

  it("forces a password reset", async () => {
    await superuserPrisma.user.update({ where: { id: frontDeskInA.id }, data: { mustChangePassword: false } })
    const result = await forcePasswordReset(clinicAdminA, frontDeskInA.id)
    expect(result).toEqual({ ok: true })
    expect((await superuserPrisma.user.findUniqueOrThrow({ where: { id: frontDeskInA.id } })).mustChangePassword).toBe(
      true
    )
  })

  it("unlocks a locked account", async () => {
    await superuserPrisma.user.update({
      where: { id: frontDeskInA.id },
      data: { failedLoginAttempts: 4, lockedUntil: new Date(Date.now() + 60_000) },
    })
    const result = await unlockAccount(clinicAdminA, frontDeskInA.id)
    expect(result).toEqual({ ok: true })
    const row = await superuserPrisma.user.findUniqueOrThrow({ where: { id: frontDeskInA.id } })
    expect(row.failedLoginAttempts).toBe(0)
    expect(row.lockedUntil).toBeNull()
  })
})
