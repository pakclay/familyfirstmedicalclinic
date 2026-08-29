import { afterAll, beforeAll, describe, expect, it } from "vitest"
import bcrypt from "bcryptjs"
import { Role, Sex } from "@prisma/client"
import { superuserPrisma } from "@/lib/test/superuser-prisma"
import { prisma } from "@/lib/db/prisma"
import {
  isLockedOut,
  recordFailedLogin,
  recordSuccessfulLogin,
  changeOwnPassword,
  generateTempPassword,
  listUsers,
  listUsersForClinic,
  listUsersForBranch,
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
  let branch: { id: string }
  let user: { id: string }
  let subject: AbilitySubject
  const CURRENT_PASSWORD = "InitialPass123"

  beforeAll(async () => {
    holding = await superuserPrisma.holdingCompany.create({
      data: { name: "Test Holding — users" },
    })
    const clinic = await superuserPrisma.clinic.create({
      data: { holdingCompanyId: holding.id, name: "Clinic Users" },
    })
    branch = await superuserPrisma.branch.create({
      data: {
        clinicId: clinic.id,
        name: "Branch Users",
        slug: `branch-users-${Date.now()}`,
        address: "1 Test St",
        city: "Test City",
        phone: "0000",
        operatingHours: {},
      },
    })
    user = await superuserPrisma.user.create({
      data: {
        branchId: branch.id,
        name: "Lockout Test User",
        email: `lockout-${Date.now()}@test.local`,
        passwordHash: await bcrypt.hash(CURRENT_PASSWORD, 10),
        role: Role.FRONT_DESK,
        mustChangePassword: true,
      },
    })
    subject = { id: user.id, role: Role.FRONT_DESK, branchId: branch.id, holdingCompanyId: null }
  })

  afterAll(async () => {
    await superuserPrisma.auditLog.deleteMany({ where: { branchId: branch.id } })
    await superuserPrisma.user.deleteMany({ where: { branchId: branch.id } })
    const { clinicId } = await superuserPrisma.branch.findUniqueOrThrow({ where: { id: branch.id }, select: { clinicId: true } })
    await superuserPrisma.branch.deleteMany({ where: { id: branch.id } })
    await superuserPrisma.clinic.delete({ where: { id: clinicId } })
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
  let branchA: { id: string }
  let branchB: { id: string }
  let clinicAdminA: AbilitySubject
  let holdingAdmin: AbilitySubject
  let frontDeskInA: { id: string }
  let frontDeskInB: { id: string }

  beforeAll(async () => {
    holding = await superuserPrisma.holdingCompany.create({ data: { name: "Test Holding — user mgmt" } })
    const clinicA = await superuserPrisma.clinic.create({ data: { holdingCompanyId: holding.id, name: "Clinic A" } })
    const clinicB = await superuserPrisma.clinic.create({ data: { holdingCompanyId: holding.id, name: "Clinic B" } })
    branchA = await superuserPrisma.branch.create({
      data: {
        clinicId: clinicA.id,
        name: "Branch A",
        slug: `branch-mgmt-a-${Date.now()}`,
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
        slug: `branch-mgmt-b-${Date.now()}`,
        address: "2 Test St",
        city: "Test City",
        phone: "0000",
        operatingHours: {},
      },
    })

    const adminUser = await superuserPrisma.user.create({
      data: {
        branchId: branchA.id,
        name: "Clinic A Admin",
        email: `admin-a-${Date.now()}@test.local`,
        passwordHash: "x",
        role: Role.CLINIC_ADMIN,
      },
    })
    clinicAdminA = { id: adminUser.id, role: Role.CLINIC_ADMIN, branchId: branchA.id, holdingCompanyId: null }

    const holdingUser = await superuserPrisma.user.create({
      data: {
        holdingCompanyId: holding.id,
        name: "Holding Owner",
        email: `owner-mgmt-${Date.now()}@test.local`,
        passwordHash: "x",
        role: Role.HOLDING_ADMIN,
      },
    })
    holdingAdmin = { id: holdingUser.id, role: Role.HOLDING_ADMIN, branchId: null, holdingCompanyId: holding.id }

    const fdA = await superuserPrisma.user.create({
      data: {
        branchId: branchA.id,
        name: "Front Desk A",
        email: `fd-a-${Date.now()}@test.local`,
        passwordHash: "x",
        role: Role.FRONT_DESK,
      },
    })
    frontDeskInA = { id: fdA.id }

    const fdB = await superuserPrisma.user.create({
      data: {
        branchId: branchB.id,
        name: "Front Desk B",
        email: `fd-b-${Date.now()}@test.local`,
        passwordHash: "x",
        role: Role.FRONT_DESK,
      },
    })
    frontDeskInB = { id: fdB.id }
  })

  afterAll(async () => {
    await superuserPrisma.auditLog.deleteMany({ where: { branchId: { in: [branchA.id, branchB.id] } } })
    await superuserPrisma.doctor.deleteMany({ where: { branchId: { in: [branchA.id, branchB.id] } } })
    await superuserPrisma.user.deleteMany({ where: { branchId: { in: [branchA.id, branchB.id] } } })
    await superuserPrisma.user.delete({ where: { id: holdingAdmin.id } })
    await superuserPrisma.branch.deleteMany({ where: { id: { in: [branchA.id, branchB.id] } } })
    await superuserPrisma.clinic.deleteMany({ where: { holdingCompanyId: holding.id } })
    await superuserPrisma.holdingCompany.deleteMany({ where: { id: holding.id } })
    await superuserPrisma.$disconnect()
    await prisma.$disconnect()
  })

  it("lets a clinic admin create a front desk account in their own branch", async () => {
    const result = await createUser(clinicAdminA, {
      name: "New Staff",
      email: `new-staff-${Date.now()}@test.local`,
      role: "FRONT_DESK",
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.user.branchId).toBe(branchA.id)
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

  it("ignores a clinic admin's attempt to assign a user to a different branch", async () => {
    const result = await createUser(clinicAdminA, {
      name: "Should Be In A",
      email: `should-be-a-${Date.now()}@test.local`,
      role: "FRONT_DESK",
      branchId: branchB.id, // attacker-supplied — must be ignored
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.user.branchId).toBe(branchA.id)
  })

  it("lets a holding admin create a doctor in any branch, with the paired Doctor row", async () => {
    const result = await createUser(holdingAdmin, {
      name: "Dr. New",
      email: `dr-new-${Date.now()}@test.local`,
      role: "DOCTOR",
      branchId: branchB.id,
      licenseNumber: "LIC-999",
      consultationFeePesos: "500",
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.user.branchId).toBe(branchB.id)
    expect(result.user.doctor).toEqual({
      licenseNumber: "LIC-999",
      specialization: "General Practitioner",
      consultationFeePesos: 500,
    })
  })

  it("rejects a duplicate email", async () => {
    const email = `dupe-${Date.now()}@test.local`
    const first = await createUser(holdingAdmin, { name: "First", email, role: "FRONT_DESK", branchId: branchA.id })
    expect(first.ok).toBe(true)
    const second = await createUser(holdingAdmin, { name: "Second", email, role: "FRONT_DESK", branchId: branchA.id })
    expect(second).toEqual({ ok: false, error: "An account with that email already exists." })
  })

  it("scopes listUsers to the clinic admin's own branch, front desk/doctor only", async () => {
    const rows = await listUsers(clinicAdminA)
    expect(rows.some((r) => r.id === frontDeskInA.id)).toBe(true)
    expect(rows.some((r) => r.id === frontDeskInB.id)).toBe(false)
    expect(rows.every((r) => r.role === "FRONT_DESK" || r.role === "DOCTOR")).toBe(true)
  })

  it("lets a holding admin list users across every branch", async () => {
    const rows = await listUsers(holdingAdmin)
    expect(rows.some((r) => r.id === frontDeskInA.id)).toBe(true)
    expect(rows.some((r) => r.id === frontDeskInB.id)).toBe(true)
  })

  it("returns null for a user outside the clinic admin's branch — not an error, not a leak", async () => {
    const result = await getManagedUserById(clinicAdminA, frontDeskInB.id)
    expect(result).toBeNull()
  })

  it("lets a clinic admin update a front desk account in their branch", async () => {
    const result = await updateUser(clinicAdminA, frontDeskInA.id, { name: "Front Desk A Renamed" })
    expect(result).toEqual({ ok: true })
    const row = await superuserPrisma.user.findUniqueOrThrow({ where: { id: frontDeskInA.id } })
    expect(row.name).toBe("Front Desk A Renamed")
  })

  it("blocks updating a user outside the clinic admin's branch", async () => {
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

/**
 * Moving a user between branches — the console's branch picker on
 * /console/users/[id]. Two things make this worth its own fixture: a user's
 * branch is the whole basis of every scoping decision elsewhere, and a
 * DOCTOR carries a *second* branch_id on its own row that has to travel
 * with it.
 *
 * `move-` prefixes on every slug/email keep this suite from colliding with
 * the other describes sharing this database.
 */
describe("updateUser — branch reassignment", () => {
  const stamp = Date.now()
  let holding: { id: string }
  let clinicOneId: string
  let branchA: { id: string }
  let siblingOfA: { id: string }
  let branchB: { id: string }
  let inactiveBranch: { id: string }
  let holdingAdmin: AbilitySubject
  let clinicAdminA: AbilitySubject
  let frontDeskInA: { id: string }
  let doctorUserId: string
  let doctorRowId: string
  let patientInA: { id: string }

  async function makeBranch(clinicId: string, name: string, slug: string, isActive = true) {
    return superuserPrisma.branch.create({
      data: {
        clinicId,
        name,
        slug: `${slug}-${stamp}`,
        address: "1 Move St",
        city: "Move City",
        phone: "0000",
        operatingHours: {},
        isActive,
      },
    })
  }

  beforeAll(async () => {
    holding = await superuserPrisma.holdingCompany.create({ data: { name: `Test Holding — move ${stamp}` } })
    const clinicOne = await superuserPrisma.clinic.create({
      data: { holdingCompanyId: holding.id, name: `Move Clinic One ${stamp}` },
    })
    const clinicTwo = await superuserPrisma.clinic.create({
      data: { holdingCompanyId: holding.id, name: `Move Clinic Two ${stamp}` },
    })
    clinicOneId = clinicOne.id

    // branchA and siblingOfA share a parent clinic — the boundary the Branch
    // refactor introduced. branchB is the older cross-clinic control.
    branchA = await makeBranch(clinicOne.id, "Move Branch A", "move-a")
    siblingOfA = await makeBranch(clinicOne.id, "Move Sibling A", "move-sib-a")
    branchB = await makeBranch(clinicTwo.id, "Move Branch B", "move-b")
    inactiveBranch = await makeBranch(clinicOne.id, "Move Closed", "move-closed", false)

    const owner = await superuserPrisma.user.create({
      data: {
        holdingCompanyId: holding.id,
        name: "Move Holding Owner",
        email: `move-owner-${stamp}@test.local`,
        passwordHash: "x",
        role: Role.HOLDING_ADMIN,
      },
    })
    holdingAdmin = { id: owner.id, role: Role.HOLDING_ADMIN, branchId: null, holdingCompanyId: holding.id }

    const admin = await superuserPrisma.user.create({
      data: {
        branchId: branchA.id,
        name: "Move Clinic Admin A",
        email: `move-admin-a-${stamp}@test.local`,
        passwordHash: "x",
        role: Role.CLINIC_ADMIN,
      },
    })
    clinicAdminA = { id: admin.id, role: Role.CLINIC_ADMIN, branchId: branchA.id, holdingCompanyId: null }

    frontDeskInA = await superuserPrisma.user.create({
      data: {
        branchId: branchA.id,
        name: "Move Front Desk A",
        email: `move-fd-a-${stamp}@test.local`,
        passwordHash: "x",
        role: Role.FRONT_DESK,
      },
    })

    const doctorUser = await superuserPrisma.user.create({
      data: {
        branchId: branchA.id,
        name: "Move Dr. A",
        email: `move-dr-a-${stamp}@test.local`,
        passwordHash: "x",
        role: Role.DOCTOR,
      },
    })
    doctorUserId = doctorUser.id
    const doctorRow = await superuserPrisma.doctor.create({
      data: {
        userId: doctorUser.id,
        branchId: branchA.id,
        licenseNumber: `MOVE-LIC-${stamp}`,
        consultationFee: 50000,
      },
    })
    doctorRowId = doctorRow.id

    patientInA = await superuserPrisma.patient.create({
      data: {
        branchId: branchA.id,
        firstName: "Move",
        lastName: "Patient",
        birthdate: new Date("1990-01-01"),
        sex: Sex.FEMALE,
        phone: "09170000000",
        address: "1 Move St",
        emergencyContactName: "Kin",
        emergencyContactPhone: "09170000001",
      },
    })
  })

  afterAll(async () => {
    const branchIds = [branchA.id, siblingOfA.id, branchB.id, inactiveBranch.id]
    await superuserPrisma.queueEntry.deleteMany({ where: { branchId: { in: branchIds } } })
    await superuserPrisma.auditLog.deleteMany({ where: { branchId: { in: branchIds } } })
    await superuserPrisma.patient.deleteMany({ where: { branchId: { in: branchIds } } })
    await superuserPrisma.doctor.deleteMany({ where: { branchId: { in: branchIds } } })
    await superuserPrisma.user.deleteMany({ where: { branchId: { in: branchIds } } })
    await superuserPrisma.user.deleteMany({ where: { holdingCompanyId: holding.id } })
    await superuserPrisma.branch.deleteMany({ where: { id: { in: branchIds } } })
    await superuserPrisma.clinic.deleteMany({ where: { holdingCompanyId: holding.id } })
    await superuserPrisma.holdingCompany.deleteMany({ where: { id: holding.id } })
    await superuserPrisma.$disconnect()
    await prisma.$disconnect()
  })

  /** Park the doctor back in branchA so each test starts from a known branch. */
  async function resetDoctorToBranchA() {
    await superuserPrisma.user.update({ where: { id: doctorUserId }, data: { branchId: branchA.id } })
    await superuserPrisma.doctor.update({ where: { id: doctorRowId }, data: { branchId: branchA.id } })
    await superuserPrisma.queueEntry.deleteMany({ where: { doctorId: doctorRowId } })
  }

  async function giveDoctorAnEntry(status: "WAITING" | "COMPLETED", queueNumber: number) {
    return superuserPrisma.queueEntry.create({
      data: {
        branchId: branchA.id,
        patientId: patientInA.id,
        doctorId: doctorRowId,
        queueDate: new Date("2099-01-01T00:00:00Z"),
        queueNumber,
        status,
        source: "WALK_IN",
        accessToken: `move-tok-${stamp}-${queueNumber}`,
      },
    })
  }

  it("omitting branchId leaves the user's branch untouched", async () => {
    const result = await updateUser(holdingAdmin, frontDeskInA.id, { name: "Move Front Desk A" })
    expect(result).toEqual({ ok: true })
    const row = await superuserPrisma.user.findUniqueOrThrow({ where: { id: frontDeskInA.id } })
    expect(row.branchId).toBe(branchA.id)
  })

  it("moves a user to a sibling branch under the same clinic", async () => {
    const result = await updateUser(holdingAdmin, frontDeskInA.id, {
      name: "Move Front Desk A",
      branchId: siblingOfA.id,
    })
    expect(result).toEqual({ ok: true })
    const row = await superuserPrisma.user.findUniqueOrThrow({ where: { id: frontDeskInA.id } })
    expect(row.branchId).toBe(siblingOfA.id)

    // Put them back, which also proves the move works in both directions
    // rather than only toward one branch.
    const back = await updateUser(holdingAdmin, frontDeskInA.id, {
      name: "Move Front Desk A",
      branchId: branchA.id,
    })
    expect(back).toEqual({ ok: true })
    expect((await superuserPrisma.user.findUniqueOrThrow({ where: { id: frontDeskInA.id } })).branchId).toBe(branchA.id)
  })

  it("audit-logs the move against the destination branch, recording both ends", async () => {
    await updateUser(holdingAdmin, frontDeskInA.id, { name: "Move Front Desk A", branchId: branchB.id })
    const log = await superuserPrisma.auditLog.findFirst({
      where: { entityId: frontDeskInA.id, action: "user.branch_changed" },
      orderBy: { createdAt: "desc" },
    })
    expect(log).toBeTruthy()
    expect(log!.branchId).toBe(branchB.id)
    expect(log!.changes).toMatchObject({ fromBranchId: branchA.id, toBranchId: branchB.id })

    await updateUser(holdingAdmin, frontDeskInA.id, { name: "Move Front Desk A", branchId: branchA.id })
  })

  it("moves a doctor's Doctor row in lockstep with their user account", async () => {
    await resetDoctorToBranchA()
    const result = await updateUser(holdingAdmin, doctorUserId, { name: "Move Dr. A", branchId: siblingOfA.id })
    expect(result).toEqual({ ok: true })

    const user = await superuserPrisma.user.findUniqueOrThrow({ where: { id: doctorUserId } })
    const doctor = await superuserPrisma.doctor.findUniqueOrThrow({ where: { id: doctorRowId } })
    expect(user.branchId).toBe(siblingOfA.id)
    // The point of the test: Doctor.branch_id is its own non-nullable column,
    // so a move that updated only the user would leave the doctor listed in
    // branchA's assignment picker while their account lived in the sibling.
    expect(doctor.branchId).toBe(siblingOfA.id)
    expect(doctor.branchId).toBe(user.branchId)
  })

  it("refuses to move a doctor who still has unfinished queue entries, and moves nothing", async () => {
    await resetDoctorToBranchA()
    await giveDoctorAnEntry("WAITING", 90001)

    const result = await updateUser(holdingAdmin, doctorUserId, { name: "Move Dr. A", branchId: siblingOfA.id })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain("unfinished queue")

    // Neither row may have moved — a refusal that still wrote half the change
    // would be worse than no guard at all.
    expect((await superuserPrisma.user.findUniqueOrThrow({ where: { id: doctorUserId } })).branchId).toBe(branchA.id)
    expect((await superuserPrisma.doctor.findUniqueOrThrow({ where: { id: doctorRowId } })).branchId).toBe(branchA.id)
  })

  /**
   * The positive control for the guard above, and the reason it exists as a
   * separate test: the first implementation counted on the bare Prisma
   * client, outside runWithRls. queue_entries is RLS-protected, so with no
   * GUCs set the policy matched nothing, the count was always 0, and the
   * guard could never fire. Both halves have to hold — refuses while the
   * entry is live, allows once it is finished — or a guard that blocks
   * everything and a guard that blocks nothing both look correct.
   */
  it("allows the same move once that entry reaches a finished state", async () => {
    await resetDoctorToBranchA()
    const entry = await giveDoctorAnEntry("WAITING", 90002)

    const blocked = await updateUser(holdingAdmin, doctorUserId, { name: "Move Dr. A", branchId: siblingOfA.id })
    expect(blocked.ok).toBe(false)

    await superuserPrisma.queueEntry.update({ where: { id: entry.id }, data: { status: "COMPLETED" } })

    const allowed = await updateUser(holdingAdmin, doctorUserId, { name: "Move Dr. A", branchId: siblingOfA.id })
    expect(allowed).toEqual({ ok: true })
    expect((await superuserPrisma.doctor.findUniqueOrThrow({ where: { id: doctorRowId } })).branchId).toBe(
      siblingOfA.id
    )
  })

  it("refuses a clinic admin moving their own staff into another branch", async () => {
    const result = await updateUser(clinicAdminA, frontDeskInA.id, {
      name: "Move Front Desk A",
      branchId: siblingOfA.id,
    })
    expect(result).toEqual({
      ok: false,
      error: "Only a holding admin can move a user to another branch.",
    })
    // A clinic admin is confined to their own branch by canManageTarget, so
    // without this check the move would be a one-way exit from their scope.
    expect((await superuserPrisma.user.findUniqueOrThrow({ where: { id: frontDeskInA.id } })).branchId).toBe(branchA.id)
  })

  it("refuses to give a holding admin a branch", async () => {
    const result = await updateUser(holdingAdmin, holdingAdmin.id, {
      name: "Move Holding Owner",
      branchId: branchA.id,
    })
    expect(result).toEqual({ ok: false, error: "A holding admin isn't attached to a branch." })
    expect((await superuserPrisma.user.findUniqueOrThrow({ where: { id: holdingAdmin.id } })).branchId).toBeNull()
  })

  it("refuses a move into an inactive branch", async () => {
    const result = await updateUser(holdingAdmin, frontDeskInA.id, {
      name: "Move Front Desk A",
      branchId: inactiveBranch.id,
    })
    expect(result).toEqual({ ok: false, error: "That branch is inactive." })
    expect((await superuserPrisma.user.findUniqueOrThrow({ where: { id: frontDeskInA.id } })).branchId).toBe(branchA.id)
  })

  it("refuses a branch id that doesn't exist", async () => {
    const result = await updateUser(holdingAdmin, frontDeskInA.id, {
      name: "Move Front Desk A",
      branchId: "00000000-0000-0000-0000-000000000000",
    })
    expect(result).toEqual({ ok: false, error: "Select a branch." })
    expect((await superuserPrisma.user.findUniqueOrThrow({ where: { id: frontDeskInA.id } })).branchId).toBe(branchA.id)
  })

  it("listUsersForBranch returns only that branch's staff, not a sibling's under the same clinic", async () => {
    await superuserPrisma.user.update({ where: { id: frontDeskInA.id }, data: { branchId: branchA.id } })
    const moved = await superuserPrisma.user.create({
      data: {
        branchId: siblingOfA.id,
        name: "Move Sibling Staff",
        email: `move-sib-staff-${stamp}@test.local`,
        passwordHash: "x",
        role: Role.FRONT_DESK,
      },
    })

    const inA = await listUsersForBranch(holdingAdmin, branchA.id)
    expect(inA.some((u) => u.id === frontDeskInA.id)).toBe(true)
    // The sibling shares a parent clinic, so a clinic-level filter would
    // wrongly include them here.
    expect(inA.some((u) => u.id === moved.id)).toBe(false)

    // Positive control: the sibling's own branch does return them, so the
    // exclusion above is a branch match rather than a query that finds nothing.
    const inSibling = await listUsersForBranch(holdingAdmin, siblingOfA.id)
    expect(inSibling.some((u) => u.id === moved.id)).toBe(true)
  })

  it("listUsersForBranch gives a clinic admin their own branch and nothing else", async () => {
    const own = await listUsersForBranch(clinicAdminA, branchA.id)
    expect(own.some((u) => u.id === frontDeskInA.id)).toBe(true)
    // Clinic admins see front desk/doctor only — not their own peer row.
    expect(own.every((u) => u.role === "FRONT_DESK" || u.role === "DOCTOR")).toBe(true)

    // A sibling branch under the same clinic is not theirs to inspect.
    expect(await listUsersForBranch(clinicAdminA, siblingOfA.id)).toEqual([])
    expect(await listUsersForBranch(clinicAdminA, branchB.id)).toEqual([])
  })

  it("keeps listUsersForClinic consistent with the move", async () => {
    await superuserPrisma.user.update({ where: { id: frontDeskInA.id }, data: { branchId: branchA.id } })
    const before = await listUsersForClinic(holdingAdmin, clinicOneId)
    expect(before.some((u) => u.id === frontDeskInA.id)).toBe(true)

    // branchB sits under the other clinic, so the user should leave this
    // clinic's staff list entirely once moved.
    await updateUser(holdingAdmin, frontDeskInA.id, { name: "Move Front Desk A", branchId: branchB.id })
    const after = await listUsersForClinic(holdingAdmin, clinicOneId)
    expect(after.some((u) => u.id === frontDeskInA.id)).toBe(false)

    await updateUser(holdingAdmin, frontDeskInA.id, { name: "Move Front Desk A", branchId: branchA.id })
  })
})
