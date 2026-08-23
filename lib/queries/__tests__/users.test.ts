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
