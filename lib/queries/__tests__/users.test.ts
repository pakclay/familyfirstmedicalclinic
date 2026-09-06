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
  regenerateTempPassword,
  changeUserRole,
  unlockAccount,
  LOGIN_LOCKOUT_THRESHOLD,
  LOGIN_LOCKOUT_DURATION_MINUTES,
} from "@/lib/queries/users"
import { assignableRoles, type AbilitySubject } from "@/lib/permissions/ability"

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
    subject = { id: user.id, role: Role.FRONT_DESK, branchId: branch.id, clinicId: null, holdingCompanyId: null }
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
  let clinicA: { id: string }
  let clinicB: { id: string }
  let branchAdminA: AbilitySubject
  let clinicAdmin: AbilitySubject
  let otherClinicAdmin: AbilitySubject
  let holdingAdmin: AbilitySubject
  let frontDeskInA: { id: string }
  let frontDeskInB: { id: string }

  beforeAll(async () => {
    holding = await superuserPrisma.holdingCompany.create({ data: { name: "Test Holding — user mgmt" } })
    clinicA = await superuserPrisma.clinic.create({ data: { holdingCompanyId: holding.id, name: "Clinic A" } })
    clinicB = await superuserPrisma.clinic.create({ data: { holdingCompanyId: holding.id, name: "Clinic B" } })
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
        role: Role.BRANCH_ADMIN,
      },
    })
    branchAdminA = { id: adminUser.id, role: Role.BRANCH_ADMIN, branchId: branchA.id, clinicId: null, holdingCompanyId: null }

    const holdingUser = await superuserPrisma.user.create({
      data: {
        holdingCompanyId: holding.id,
        name: "Holding Owner",
        email: `owner-mgmt-${Date.now()}@test.local`,
        passwordHash: "x",
        role: Role.HOLDING_ADMIN,
      },
    })
    holdingAdmin = { id: holdingUser.id, role: Role.HOLDING_ADMIN, branchId: null, clinicId: null, holdingCompanyId: holding.id }

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

    // One clinic-level admin per clinic. Branchless and deliberately given no
    // holdingCompanyId — its company is reached through its clinic, which is
    // what makes the "visible to its holding admin" test below load-bearing.
    const clinicAdminUser = await superuserPrisma.user.create({
      data: {
        clinicId: clinicA.id,
        name: "Clinic A Admin",
        email: `clinic-admin-a-${Date.now()}@test.local`,
        passwordHash: "x",
        role: Role.CLINIC_ADMIN,
      },
    })
    clinicAdmin = { id: clinicAdminUser.id, role: Role.CLINIC_ADMIN, branchId: null, clinicId: clinicA.id, holdingCompanyId: null }

    const otherClinicAdminUser = await superuserPrisma.user.create({
      data: {
        clinicId: clinicB.id,
        name: "Clinic B Admin",
        email: `clinic-admin-b-${Date.now()}@test.local`,
        passwordHash: "x",
        role: Role.CLINIC_ADMIN,
      },
    })
    otherClinicAdmin = { id: otherClinicAdminUser.id, role: Role.CLINIC_ADMIN, branchId: null, clinicId: clinicB.id, holdingCompanyId: null }
  })

  afterAll(async () => {
    await superuserPrisma.auditLog.deleteMany({ where: { branchId: { in: [branchA.id, branchB.id] } } })
    // Queue entries and patients come from the doctor-demotion test, and
    // both reference the branch — deleted before the doctors they point at.
    await superuserPrisma.queueEntry.deleteMany({ where: { branchId: { in: [branchA.id, branchB.id] } } })
    await superuserPrisma.patient.deleteMany({ where: { branchId: { in: [branchA.id, branchB.id] } } })
    await superuserPrisma.doctor.deleteMany({ where: { branchId: { in: [branchA.id, branchB.id] } } })
    await superuserPrisma.user.deleteMany({ where: { branchId: { in: [branchA.id, branchB.id] } } })
    await superuserPrisma.user.delete({ where: { id: holdingAdmin.id } })
    // Clinic admins hang off the clinic, not a branch — the branchId sweep
    // above misses them, and the clinic delete below would trip their FK.
    await superuserPrisma.user.deleteMany({ where: { clinicId: { in: [clinicA.id, clinicB.id] } } })
    await superuserPrisma.branch.deleteMany({ where: { id: { in: [branchA.id, branchB.id] } } })
    await superuserPrisma.clinic.deleteMany({ where: { holdingCompanyId: holding.id } })
    await superuserPrisma.holdingCompany.deleteMany({ where: { id: holding.id } })
    await superuserPrisma.$disconnect()
    await prisma.$disconnect()
  })

  describe("holding admin assigning the clinic-admin role", () => {
    // The role holds a clinic and no branch. Both write paths — promoting an
    // existing account and creating a new one — must demand the clinic and
    // write it, and a demotion must clear it again, or the row trips
    // users_role_scope_check. Found in production: the role page offered no
    // clinic picker, so every promotion was refused.
    it("promotes an account to clinic admin only with a clinic, and writes the clinic link", async () => {
      const fd = await superuserPrisma.user.create({
        data: {
          branchId: branchA.id,
          name: "Promotable",
          email: `promotable-${Date.now()}@test.local`,
          passwordHash: "x",
          role: Role.FRONT_DESK,
        },
      })

      expect(await changeUserRole(holdingAdmin, fd.id, { role: "CLINIC_ADMIN" })).toEqual({
        ok: false,
        error: "Select a clinic for this role.",
      })

      expect(await changeUserRole(holdingAdmin, fd.id, { role: "CLINIC_ADMIN", clinicId: clinicA.id })).toEqual({ ok: true })
      const promoted = await superuserPrisma.user.findUniqueOrThrow({ where: { id: fd.id } })
      expect(promoted.role).toBe("CLINIC_ADMIN")
      expect(promoted.clinicId).toBe(clinicA.id)
      expect(promoted.branchId).toBeNull()
      // Deliberately null — its company is reached through its clinic.
      expect(promoted.holdingCompanyId).toBeNull()

      // Demotion must clear the clinic link, or the row fails the CHECK.
      expect(await changeUserRole(holdingAdmin, fd.id, { role: "FRONT_DESK", branchId: branchA.id })).toEqual({ ok: true })
      const demoted = await superuserPrisma.user.findUniqueOrThrow({ where: { id: fd.id } })
      expect(demoted.role).toBe("FRONT_DESK")
      expect(demoted.clinicId).toBeNull()
      expect(demoted.branchId).toBe(branchA.id)
    })

    it("refuses a clinic outside the actor's company", async () => {
      const fd = await superuserPrisma.user.create({
        data: {
          branchId: branchA.id,
          name: "Promotable Too",
          email: `promotable2-${Date.now()}@test.local`,
          passwordHash: "x",
          role: Role.FRONT_DESK,
        },
      })
      // `clinics` has no RLS: the where-clause in changeUserRole is the whole
      // boundary. An unknown or foreign clinic id reads as "select a clinic".
      expect(
        await changeUserRole(holdingAdmin, fd.id, { role: "CLINIC_ADMIN", clinicId: "00000000-0000-0000-0000-000000000000" })
      ).toEqual({ ok: false, error: "Select a clinic." })
    })

    it("creates a clinic admin only with a clinic, and writes the clinic link", async () => {
      expect(
        await createUser(holdingAdmin, { name: "No Clinic", email: `noclinic-${Date.now()}@test.local`, role: "CLINIC_ADMIN" })
      ).toEqual({ ok: false, error: "Select a clinic." })

      const made = await createUser(holdingAdmin, {
        name: "Made Clinic Admin",
        email: `made-ca-${Date.now()}@test.local`,
        role: "CLINIC_ADMIN",
        clinicId: clinicB.id,
      })
      expect(made.ok).toBe(true)
      if (!made.ok) return
      const row = await superuserPrisma.user.findUniqueOrThrow({ where: { id: made.user.id } })
      expect(row.role).toBe("CLINIC_ADMIN")
      expect(row.clinicId).toBe(clinicB.id)
      expect(row.branchId).toBeNull()
      expect(row.holdingCompanyId).toBeNull()
    })
  })

  describe("clinic admin", () => {
    it("creates a front desk account in its own clinic's branch, audit row and all", async () => {
      // Runs as webinar_app (APP_DATABASE_URL, non-superuser) so audit_logs'
      // INSERT policy actually bites: without the clinic arm added in the
      // audit_logs_clinic_admin_insert migration, the audit write for a
      // branchless actor is refused and this whole transaction rolls back.
      const result = await createUser(clinicAdmin, {
        name: "Clinic-Made Front Desk",
        email: `clinic-made-fd-${Date.now()}@test.local`,
        role: "FRONT_DESK",
        branchId: branchA.id,
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const log = await superuserPrisma.auditLog.findFirst({
        where: { action: "user.created", entityId: result.user.id },
      })
      expect(log?.userId).toBe(clinicAdmin.id)
      expect(log?.branchId).toBe(branchA.id)
    })

    it("refuses a branch in a sibling clinic — a forged id reads as 'not found', never as a choice", async () => {
      // `branches` has no RLS: the where-clause in createUser is the whole
      // boundary. An account minted there would have full RLS-blessed access
      // to that branch's patients, queue and payments.
      const result = await createUser(clinicAdmin, {
        name: "Sneaky",
        email: `sneaky-${Date.now()}@test.local`,
        role: "FRONT_DESK",
        branchId: branchB.id,
      })
      expect(result).toEqual({ ok: false, error: "Select a branch." })
      expect(await superuserPrisma.user.count({ where: { branchId: branchB.id, name: "Sneaky" } })).toBe(0)
    })

    it("may create a branch admin in its clinic, but never a peer or a holding admin", async () => {
      const branchAdminMade = await createUser(clinicAdmin, {
        name: "Clinic-Made Branch Admin",
        email: `clinic-made-ba-${Date.now()}@test.local`,
        role: "BRANCH_ADMIN",
        branchId: branchA.id,
      })
      expect(branchAdminMade.ok).toBe(true)

      const denied = { ok: false, error: "You can't create an account with that role." }
      expect(
        await createUser(clinicAdmin, { name: "Peer", email: `peer-${Date.now()}@test.local`, role: "CLINIC_ADMIN", clinicId: clinicA.id })
      ).toEqual(denied)
      expect(
        await createUser(clinicAdmin, { name: "Boss", email: `boss-${Date.now()}@test.local`, role: "HOLDING_ADMIN" })
      ).toEqual(denied)
    })

    it("cannot manage an account outside its clinic, a peer, or a holding admin", async () => {
      // All three read as "not found" — the same non-enumeration answer the
      // branch admin gets for a sibling branch.
      for (const targetId of [frontDeskInB.id, otherClinicAdmin.id, holdingAdmin.id]) {
        expect(await setUserActive(clinicAdmin, targetId, false)).toEqual({ ok: false, error: "User not found." })
        expect(await getManagedUserById(clinicAdmin, targetId)).toBeNull()
      }
      // ...while its own clinic's staff are reachable.
      expect(await getManagedUserById(clinicAdmin, frontDeskInA.id)).not.toBeNull()
    })

    it("cannot issue a password for an existing account", async () => {
      // The one-step impersonation path: rotate a front desk password, sign
      // in, inherit that branch's patients, queue and payments — with no new
      // row for anyone to notice. Refused even inside its own clinic.
      expect(await regenerateTempPassword(clinicAdmin, frontDeskInA.id)).toEqual({
        ok: false,
        error: "Ask a holding admin to issue a password.",
      })
    })

    it("assignableRoles: front desk, doctor and branch admin — never a peer or a superior", () => {
      expect(assignableRoles(clinicAdmin)).toEqual(["FRONT_DESK", "DOCTOR", "BRANCH_ADMIN"])
      expect(assignableRoles(holdingAdmin)).toEqual(["FRONT_DESK", "DOCTOR", "BRANCH_ADMIN", "CLINIC_ADMIN", "HOLDING_ADMIN"])
    })

    it("is visible to its holding admin", async () => {
      // branchId null AND holdingCompanyId null: matches neither of the
      // original two holdingCompanyScope arms. Regression guard for the third.
      const ids = (await listUsers(holdingAdmin)).map((u) => u.id)
      expect(ids).toContain(clinicAdmin.id)
    })

    it("the CHECK constraint refuses a clinic admin that carries a branch", async () => {
      await expect(
        superuserPrisma.user.create({
          data: {
            name: "Malformed",
            email: `malformed-${Date.now()}@test.local`,
            passwordHash: "x",
            role: Role.CLINIC_ADMIN,
            branchId: branchA.id, // a branch AND no clinic — exactly the null===null state
          },
        })
      ).rejects.toThrow(/users_role_scope_check|23514/)
    })
  })

  it("lets a branch admin create a front desk account in their own branch", async () => {
    const result = await createUser(branchAdminA, {
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

  it("blocks a branch admin from creating a branch admin account", async () => {
    const result = await createUser(branchAdminA, {
      name: "Sneaky Admin",
      email: `sneaky-${Date.now()}@test.local`,
      role: "BRANCH_ADMIN",
    })
    expect(result).toEqual({ ok: false, error: "You can't create an account with that role." })
  })

  it("ignores a branch admin's attempt to assign a user to a different branch", async () => {
    const result = await createUser(branchAdminA, {
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

  it("scopes listUsers to the branch admin's own branch, front desk/doctor only", async () => {
    const rows = await listUsers(branchAdminA)
    expect(rows.some((r) => r.id === frontDeskInA.id)).toBe(true)
    expect(rows.some((r) => r.id === frontDeskInB.id)).toBe(false)
    expect(rows.every((r) => r.role === "FRONT_DESK" || r.role === "DOCTOR")).toBe(true)
  })

  it("lets a holding admin list users across every branch", async () => {
    const rows = await listUsers(holdingAdmin)
    expect(rows.some((r) => r.id === frontDeskInA.id)).toBe(true)
    expect(rows.some((r) => r.id === frontDeskInB.id)).toBe(true)
  })

  it("returns null for a user outside the branch admin's branch — not an error, not a leak", async () => {
    const result = await getManagedUserById(branchAdminA, frontDeskInB.id)
    expect(result).toBeNull()
  })

  it("lets a branch admin update a front desk account in their branch", async () => {
    const result = await updateUser(branchAdminA, frontDeskInA.id, { name: "Front Desk A Renamed" })
    expect(result).toEqual({ ok: true })
    const row = await superuserPrisma.user.findUniqueOrThrow({ where: { id: frontDeskInA.id } })
    expect(row.name).toBe("Front Desk A Renamed")
  })

  it("blocks updating a user outside the branch admin's branch", async () => {
    const result = await updateUser(branchAdminA, frontDeskInB.id, { name: "Hijacked" })
    expect(result).toEqual({ ok: false, error: "User not found." })
  })

  it("prevents an admin from deactivating their own account", async () => {
    const result = await setUserActive(branchAdminA, branchAdminA.id, false)
    expect(result).toEqual({ ok: false, error: "You can't deactivate your own account." })
  })

  it("deactivates and reactivates a managed account, audit-logging each", async () => {
    const off = await setUserActive(branchAdminA, frontDeskInA.id, false)
    expect(off).toEqual({ ok: true })
    expect((await superuserPrisma.user.findUniqueOrThrow({ where: { id: frontDeskInA.id } })).isActive).toBe(false)

    const on = await setUserActive(branchAdminA, frontDeskInA.id, true)
    expect(on).toEqual({ ok: true })
    expect((await superuserPrisma.user.findUniqueOrThrow({ where: { id: frontDeskInA.id } })).isActive).toBe(true)

    const logs = await superuserPrisma.auditLog.findMany({
      where: { entityId: frontDeskInA.id, action: { in: ["user.deactivated", "user.reactivated"] } },
    })
    expect(logs.length).toBe(2)
  })

  it("forces a password reset", async () => {
    await superuserPrisma.user.update({ where: { id: frontDeskInA.id }, data: { mustChangePassword: false } })
    const result = await forcePasswordReset(branchAdminA, frontDeskInA.id)
    expect(result).toEqual({ ok: true })
    expect((await superuserPrisma.user.findUniqueOrThrow({ where: { id: frontDeskInA.id } })).mustChangePassword).toBe(
      true
    )
  })

  it("promotes a front desk account to branch admin", async () => {
    const u = await superuserPrisma.user.create({
      data: {
        branchId: branchA.id,
        name: "Promote Me",
        email: `promote-${Date.now()}@test.local`,
        passwordHash: "x",
        role: Role.FRONT_DESK,
      },
    })
    expect(await changeUserRole(holdingAdmin, u.id, { role: "BRANCH_ADMIN" })).toEqual({ ok: true })
    const row = await superuserPrisma.user.findUniqueOrThrow({ where: { id: u.id } })
    expect(row.role).toBe(Role.BRANCH_ADMIN)
    // Keeps the branch it already had — a straight role change should not
    // require restating where someone works.
    expect(row.branchId).toBe(branchA.id)

    const log = await superuserPrisma.auditLog.findFirst({
      where: { entityId: u.id, action: "user.role_changed" },
    })
    expect(log!.changes).toMatchObject({ fromRole: "FRONT_DESK", toRole: "BRANCH_ADMIN" })
  })

  it("creates a Doctor record when promoting to doctor, and reuses it on re-promotion", async () => {
    const u = await superuserPrisma.user.create({
      data: {
        branchId: branchA.id,
        name: "Future Doctor",
        email: `futuredoc-${Date.now()}@test.local`,
        passwordHash: "x",
        role: Role.FRONT_DESK,
      },
    })
    expect(
      await changeUserRole(holdingAdmin, u.id, {
        role: "DOCTOR",
        licenseNumber: "LIC-ROLE-1",
        consultationFeePesos: "750",
      })
    ).toEqual({ ok: true })
    const doctor = await superuserPrisma.doctor.findUniqueOrThrow({ where: { userId: u.id } })
    expect(doctor.consultationFee).toBe(75000)

    // Demote, then promote again without supplying licence details.
    expect(await changeUserRole(holdingAdmin, u.id, { role: "FRONT_DESK" })).toEqual({ ok: true })
    // The record survives demotion — consultations.doctor_id is NOT NULL, so
    // deleting it would be impossible for any doctor with history anyway.
    expect(await superuserPrisma.doctor.findUnique({ where: { userId: u.id } })).not.toBeNull()

    expect(await changeUserRole(holdingAdmin, u.id, { role: "DOCTOR" })).toEqual({ ok: true })
    const again = await superuserPrisma.doctor.findUniqueOrThrow({ where: { userId: u.id } })
    expect(again.id).toBe(doctor.id)
    expect(again.licenseNumber).toBe("LIC-ROLE-1")
  })

  it("requires licence details only for a first-time doctor promotion", async () => {
    const u = await superuserPrisma.user.create({
      data: {
        branchId: branchA.id,
        name: "No Licence",
        email: `nolicence-${Date.now()}@test.local`,
        passwordHash: "x",
        role: Role.FRONT_DESK,
      },
    })
    expect(await changeUserRole(holdingAdmin, u.id, { role: "DOCTOR" })).toEqual({
      ok: false,
      error: "A licence number is required to make someone a doctor.",
    })
    expect(await changeUserRole(holdingAdmin, u.id, { role: "DOCTOR", licenseNumber: "L1" })).toEqual({
      ok: false,
      error: "A consultation fee is required to make someone a doctor.",
    })
    expect((await superuserPrisma.user.findUniqueOrThrow({ where: { id: u.id } })).role).toBe(Role.FRONT_DESK)
  })

  it("clears the branch when promoting to holding admin, and attaches the company", async () => {
    const u = await superuserPrisma.user.create({
      data: {
        branchId: branchA.id,
        name: "Future Owner",
        email: `futureowner-${Date.now()}@test.local`,
        passwordHash: "x",
        role: Role.BRANCH_ADMIN,
      },
    })
    expect(await changeUserRole(holdingAdmin, u.id, { role: "HOLDING_ADMIN" })).toEqual({ ok: true })
    const row = await superuserPrisma.user.findUniqueOrThrow({ where: { id: u.id } })
    // Carrying a branch would list them under it while their access ignores
    // branches entirely.
    expect(row.branchId).toBeNull()
    expect(row.holdingCompanyId).toBe(holding.id)
  })

  it("cannot leave the company without a holding admin", async () => {
    // There is no separate last-admin guard, because there is no way to
    // reach the state it would defend against: a demotion needs an acting
    // holding admin and a different target, so whoever performs it is still
    // an admin when it commits. This test pins that reasoning rather than a
    // check — if someone later adds a path that demotes an admin without
    // another one acting, this is where it should start failing.
    const other = await superuserPrisma.user.create({
      data: {
        holdingCompanyId: holding.id,
        name: "Second Owner",
        email: `secondowner-${Date.now()}@test.local`,
        passwordHash: "x",
        role: Role.HOLDING_ADMIN,
      },
    })
    const otherSubject: AbilitySubject = {
      id: other.id,
      role: Role.HOLDING_ADMIN,
      branchId: null,
      clinicId: null,
      holdingCompanyId: holding.id,
    }

    // The acting admin cannot demote themselves...
    expect(await changeUserRole(otherSubject, other.id, { role: "BRANCH_ADMIN", branchId: branchA.id })).toEqual({
      ok: false,
      error: "You can't change your own role — ask another holding admin.",
    })

    // ...and demoting the *other* one leaves the actor in place, so an admin
    // always remains.
    expect(
      await changeUserRole(otherSubject, holdingAdmin.id, { role: "BRANCH_ADMIN", branchId: branchA.id })
    ).toEqual({ ok: true })
    const stillAdmin = await superuserPrisma.user.count({
      where: { role: Role.HOLDING_ADMIN, isActive: true, holdingCompanyId: holding.id },
    })
    expect(stillAdmin).toBeGreaterThanOrEqual(1)

    // Restore the fixture for the tests that follow.
    await superuserPrisma.user.update({
      where: { id: holdingAdmin.id },
      data: { role: Role.HOLDING_ADMIN, branchId: null, clinicId: null, holdingCompanyId: holding.id },
    })
    await superuserPrisma.auditLog.deleteMany({ where: { userId: other.id } })
    await superuserPrisma.user.delete({ where: { id: other.id } })
  })

  it("refuses to change your own role", async () => {
    const result = await changeUserRole(holdingAdmin, holdingAdmin.id, { role: "FRONT_DESK", branchId: branchA.id })
    expect(result).toEqual({
      ok: false,
      error: "You can't change your own role — ask another holding admin.",
    })
  })

  it("refuses a role change from anyone who isn't a holding admin", async () => {
    const before = await superuserPrisma.user.findUniqueOrThrow({ where: { id: frontDeskInA.id } })
    expect(await changeUserRole(branchAdminA, frontDeskInA.id, { role: "BRANCH_ADMIN" })).toEqual({
      ok: false,
      error: "Only a holding admin can change a role.",
    })
    expect((await superuserPrisma.user.findUniqueOrThrow({ where: { id: frontDeskInA.id } })).role).toBe(before.role)
  })

  it("refuses to demote a doctor who still has unfinished queue entries", async () => {
    const u = await superuserPrisma.user.create({
      data: {
        branchId: branchA.id,
        name: "Busy Doctor",
        email: `busydoc-${Date.now()}@test.local`,
        passwordHash: "x",
        role: Role.DOCTOR,
      },
    })
    const doc = await superuserPrisma.doctor.create({
      data: { userId: u.id, branchId: branchA.id, licenseNumber: `BUSY-${Date.now()}`, consultationFee: 1000 },
    })
    const patient = await superuserPrisma.patient.create({
      data: {
        branchId: branchA.id,
        firstName: "Role",
        lastName: "Patient",
        birthdate: new Date("1990-01-01"),
        sex: Sex.FEMALE,
        phone: "09170000000",
        address: "1 Role St",
        emergencyContactName: "Kin",
        emergencyContactPhone: "09170000001",
      },
    })
    const entry = await superuserPrisma.queueEntry.create({
      data: {
        branchId: branchA.id,
        patientId: patient.id,
        doctorId: doc.id,
        queueNumber: 91001,
        queueDate: new Date("2099-01-01T00:00:00Z"),
        status: "WAITING",
        source: "WALK_IN",
        accessToken: `role-busy-${Date.now()}`,
      },
    })

    const blocked = await changeUserRole(holdingAdmin, u.id, { role: "FRONT_DESK" })
    expect(blocked.ok).toBe(false)
    if (blocked.ok) return
    expect(blocked.error).toContain("unfinished queue")
    expect((await superuserPrisma.user.findUniqueOrThrow({ where: { id: u.id } })).role).toBe(Role.DOCTOR)

    // Positive control: finishing the entry releases the demotion.
    await superuserPrisma.queueEntry.update({ where: { id: entry.id }, data: { status: "COMPLETED" } })
    expect(await changeUserRole(holdingAdmin, u.id, { role: "FRONT_DESK" })).toEqual({ ok: true })
  })

  it("refuses a no-op role change", async () => {
    expect(await changeUserRole(holdingAdmin, frontDeskInA.id, { role: "FRONT_DESK" })).toEqual({
      ok: false,
      error: "That's already their role.",
    })
  })

  it("issues a working temporary password, and invalidates the old one", async () => {
    const email = `regen-${Date.now()}@test.local`
    const created = await createUser(holdingAdmin, {
      name: "Regen Target",
      email,
      role: "FRONT_DESK",
      branchId: branchA.id,
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const oldPassword = created.tempPassword

    const result = await regenerateTempPassword(holdingAdmin, created.user.id)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.tempPassword).not.toBe(oldPassword)
    expect(result.tempPassword.length).toBeGreaterThanOrEqual(10)

    const row = await superuserPrisma.user.findUniqueOrThrow({ where: { id: created.user.id } })
    // The returned plaintext must actually be the account's password —
    // asserting only that a string came back would pass against a function
    // that generated one and stored something else entirely.
    expect(await bcrypt.compare(result.tempPassword, row.passwordHash)).toBe(true)
    // And the old one must be dead, or "issuing a new password" would just
    // be handing out a second valid credential.
    expect(await bcrypt.compare(oldPassword, row.passwordHash)).toBe(false)
    expect(row.mustChangePassword).toBe(true)
  })

  it("clears any lockout when issuing a new password", async () => {
    await superuserPrisma.user.update({
      where: { id: frontDeskInA.id },
      data: { failedLoginAttempts: 4, lockedUntil: new Date(Date.now() + 60_000) },
    })
    const result = await regenerateTempPassword(holdingAdmin, frontDeskInA.id)
    expect(result.ok).toBe(true)

    const row = await superuserPrisma.user.findUniqueOrThrow({ where: { id: frontDeskInA.id } })
    // A lockout counts failures against the OLD password; leaving it in
    // place would block the new one too and make the action look broken.
    expect(row.failedLoginAttempts).toBe(0)
    expect(row.lockedUntil).toBeNull()
    expect(isLockedOut(row)).toBe(false)
  })

  it("audit-logs that a password was issued, without recording it", async () => {
    const result = await regenerateTempPassword(holdingAdmin, frontDeskInA.id)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const log = await superuserPrisma.auditLog.findFirst({
      where: { entityId: frontDeskInA.id, action: "user.temp_password_issued" },
      orderBy: { createdAt: "desc" },
    })
    expect(log).toBeTruthy()
    expect(log!.userId).toBe(holdingAdmin.id)
    // The value must never reach the audit trail, which is readable by every
    // holding admin and retained far longer than the password is valid.
    expect(JSON.stringify(log)).not.toContain(result.tempPassword)
  })

  it("refuses to issue the actor their own new password", async () => {
    const before = await superuserPrisma.user.findUniqueOrThrow({ where: { id: branchAdminA.id } })
    const result = await regenerateTempPassword(branchAdminA, branchAdminA.id)
    expect(result).toEqual({
      ok: false,
      error: "You can't issue yourself a new password — ask another admin.",
    })
    // changeOwnPassword requires the current password, so self-service here
    // would let a stolen session rotate its own credentials and lock the
    // real owner out. The hash must be untouched.
    const after = await superuserPrisma.user.findUniqueOrThrow({ where: { id: branchAdminA.id } })
    expect(after.passwordHash).toBe(before.passwordHash)
  })

  it("refuses to issue a password for a user outside the actor's branch", async () => {
    const before = await superuserPrisma.user.findUniqueOrThrow({ where: { id: frontDeskInB.id } })
    const result = await regenerateTempPassword(branchAdminA, frontDeskInB.id)
    expect(result).toEqual({ ok: false, error: "User not found." })
    const after = await superuserPrisma.user.findUniqueOrThrow({ where: { id: frontDeskInB.id } })
    expect(after.passwordHash).toBe(before.passwordHash)
  })

  it("unlocks a locked account", async () => {
    await superuserPrisma.user.update({
      where: { id: frontDeskInA.id },
      data: { failedLoginAttempts: 4, lockedUntil: new Date(Date.now() + 60_000) },
    })
    const result = await unlockAccount(branchAdminA, frontDeskInA.id)
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
  let branchAdminA: AbilitySubject
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
    holdingAdmin = { id: owner.id, role: Role.HOLDING_ADMIN, branchId: null, clinicId: null, holdingCompanyId: holding.id }

    const admin = await superuserPrisma.user.create({
      data: {
        branchId: branchA.id,
        name: "Move Branch Admin A",
        email: `move-admin-a-${stamp}@test.local`,
        passwordHash: "x",
        role: Role.BRANCH_ADMIN,
      },
    })
    branchAdminA = { id: admin.id, role: Role.BRANCH_ADMIN, branchId: branchA.id, clinicId: null, holdingCompanyId: null }

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

  it("refuses a branch admin moving their own staff into another branch", async () => {
    const result = await updateUser(branchAdminA, frontDeskInA.id, {
      name: "Move Front Desk A",
      branchId: siblingOfA.id,
    })
    expect(result).toEqual({
      ok: false,
      error: "Only a holding admin can move a user to another branch.",
    })
    // A branch admin is confined to their own branch by canManageTarget, so
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

  it("listUsersForBranch gives a branch admin their own branch and nothing else", async () => {
    const own = await listUsersForBranch(branchAdminA, branchA.id)
    expect(own.some((u) => u.id === frontDeskInA.id)).toBe(true)
    // Branch admins see front desk/doctor only — not their own peer row.
    expect(own.every((u) => u.role === "FRONT_DESK" || u.role === "DOCTOR")).toBe(true)

    // A sibling branch under the same clinic is not theirs to inspect.
    expect(await listUsersForBranch(branchAdminA, siblingOfA.id)).toEqual([])
    expect(await listUsersForBranch(branchAdminA, branchB.id)).toEqual([])
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
