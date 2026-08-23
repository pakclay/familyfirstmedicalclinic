import bcrypt from "bcryptjs"
import { randomBytes } from "crypto"
import type { Role, Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { runWithRls } from "@/lib/db/rls"
import { isHoldingAdmin, requireClinicId, canManageRole, type AbilitySubject } from "@/lib/permissions/ability"
import { toUserDTO, type UserDTO } from "@/lib/dto/user"
import type { CreateUserInput, EditUserInput } from "@/lib/validation/user"

/** After this many consecutive failed attempts, the account locks out. */
export const LOGIN_LOCKOUT_THRESHOLD = 5
/** How long a lockout lasts before the next attempt is evaluated normally. */
export const LOGIN_LOCKOUT_DURATION_MINUTES = 15

/**
 * Pure check against an already-fetched user row — no DB access, so it's
 * trivially unit-testable and safe to call from authorize() without an
 * extra round trip.
 */
export function isLockedOut(user: { lockedUntil: Date | null }): boolean {
  return user.lockedUntil !== null && user.lockedUntil.getTime() > Date.now()
}

/**
 * Called from auth.ts's Credentials authorize() on a wrong password. Takes
 * the count already loaded by that caller's own findUnique rather than
 * re-reading it, to avoid a lost-update race between the read and this
 * write (authorize() only ever handles one login attempt at a time per
 * request, so this is a single write, not a read-modify-write transaction —
 * acceptable here since a slightly-off count under concurrent attempts from
 * the same account only affects when the *next* lockout triggers, not
 * whether this specific attempt succeeds).
 */
export async function recordFailedLogin(userId: string, currentFailedAttempts: number): Promise<void> {
  const nextCount = currentFailedAttempts + 1
  if (nextCount >= LOGIN_LOCKOUT_THRESHOLD) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: new Date(Date.now() + LOGIN_LOCKOUT_DURATION_MINUTES * 60_000),
      },
    })
    return
  }
  await prisma.user.update({
    where: { id: userId },
    data: { failedLoginAttempts: nextCount },
  })
}

/** Called on a successful login — clears any accumulated failure count. */
export async function recordSuccessfulLogin(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { failedLoginAttempts: 0, lockedUntil: null },
  })
}

export type ChangePasswordResult = { ok: true } | { ok: false; error: string }

/**
 * Self-service password change — covers both the forced first-login flow
 * (mustChangePassword) and a voluntary later change, since both need the
 * identical guarantees (current password verified, new password actually
 * different, mustChangePassword cleared). `where: { id: user.id }` is the
 * *only* enforcement that a user can only change their own password —
 * `users` has no RLS policy at all (it's absent from the
 * enable_rls_backstop migration; auth.ts's authorize() has to read it
 * before any session/RLS context exists), so every function in this file
 * that touches another row must filter explicitly rather than leaning on
 * a database backstop the way patient/queue/payment queries can.
 */
export async function changeOwnPassword(
  user: AbilitySubject,
  currentPassword: string,
  newPassword: string
): Promise<ChangePasswordResult> {
  return runWithRls(user, async (tx) => {
    const row = await tx.user.findUniqueOrThrow({ where: { id: user.id } })

    const currentValid = await bcrypt.compare(currentPassword, row.passwordHash)
    if (!currentValid) {
      return { ok: false, error: "Current password is incorrect." }
    }

    const sameAsCurrent = await bcrypt.compare(newPassword, row.passwordHash)
    if (sameAsCurrent) {
      return { ok: false, error: "New password must be different from your current password." }
    }

    const passwordHash = await bcrypt.hash(newPassword, 10)
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false },
    })
    await tx.auditLog.create({
      data: {
        clinicId: user.clinicId,
        userId: user.id,
        action: "user.password_changed",
        entityType: "User",
        entityId: user.id,
      },
    })

    return { ok: true }
  })
}

// ─────────────────────────────────────────────────────────────────────────
// User management (holding admin: any account · clinic admin: their own
// clinic's front desk/doctor accounts only — §4's role table)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Readable, policy-satisfying by construction (6 letters + 4 digits, so
 * `lib/validation/password.ts`'s "10+ chars, a letter, a number" rule
 * always passes — never left to the odds of a random byte string
 * happening to contain both). Excludes visually-confusing characters
 * (0/O, 1/l/I) since a human has to type this in once, from wherever it
 * gets handed to them.
 */
export function generateTempPassword(): string {
  const letters = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ"
  const digits = "23456789"
  const pick = (charset: string, count: number) =>
    Array.from(randomBytes(count), (b) => charset[b % charset.length]).join("")
  const chars = (pick(letters, 6) + pick(digits, 4)).split("")
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0] % (i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join("")
}

function canManageTarget(actor: AbilitySubject, target: { role: Role; clinicId: string | null }): boolean {
  if (isHoldingAdmin(actor)) return true
  return target.clinicId === actor.clinicId && (target.role === "FRONT_DESK" || target.role === "DOCTOR")
}

const userInclude = { clinic: { select: { name: true } }, doctor: true } as const

export async function listUsers(actor: AbilitySubject): Promise<UserDTO[]> {
  const where: Prisma.UserWhereInput = isHoldingAdmin(actor)
    ? {}
    : { clinicId: requireClinicId(actor), role: { in: ["FRONT_DESK", "DOCTOR"] } }
  const rows = await prisma.user.findMany({ where, include: userInclude, orderBy: [{ role: "asc" }, { name: "asc" }] })
  return rows.map(toUserDTO)
}

/** Returns null for "doesn't exist" *and* "exists but actor can't manage it" — same non-enumeration reasoning as the login lockout not distinguishing its causes. */
export async function getManagedUserById(actor: AbilitySubject, id: string): Promise<UserDTO | null> {
  const row = await prisma.user.findUnique({ where: { id }, include: userInclude })
  if (!row || !canManageTarget(actor, row)) return null
  return toUserDTO(row)
}

export type CreateUserResult = { ok: true; user: UserDTO; tempPassword: string } | { ok: false; error: string }

export async function createUser(actor: AbilitySubject, input: CreateUserInput): Promise<CreateUserResult> {
  if (!canManageRole(actor, input.role)) {
    return { ok: false, error: "You can't create an account with that role." }
  }

  let clinicId: string | null
  if (input.role === "HOLDING_ADMIN") {
    clinicId = null
  } else if (isHoldingAdmin(actor)) {
    if (!input.clinicId) return { ok: false, error: "Select a clinic." }
    clinicId = input.clinicId
  } else {
    // Clinic admin: ignore any clinicId the form sent — they can only ever
    // create within their own clinic, and trusting a client-supplied value
    // here would be exactly the kind of hole §5's "never from a
    // client-supplied parameter" rule exists to close.
    clinicId = requireClinicId(actor)
  }

  const email = input.email.trim().toLowerCase()
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    return { ok: false, error: "An account with that email already exists." }
  }

  const tempPassword = generateTempPassword()
  const passwordHash = await bcrypt.hash(tempPassword, 10)

  const createdId = await runWithRls(actor, async (tx) => {
    const user = await tx.user.create({
      data: {
        clinicId,
        holdingCompanyId: input.role === "HOLDING_ADMIN" ? actor.holdingCompanyId : null,
        name: input.name.trim(),
        email,
        phone: input.phone?.trim() || null,
        role: input.role,
        passwordHash,
        mustChangePassword: true,
      },
    })
    if (input.role === "DOCTOR") {
      await tx.doctor.create({
        data: {
          userId: user.id,
          clinicId: clinicId!,
          licenseNumber: input.licenseNumber!.trim(),
          specialization: input.specialization?.trim() || "General Practitioner",
          consultationFee: Math.round(Number(input.consultationFeePesos) * 100),
        },
      })
    }
    await tx.auditLog.create({
      data: {
        clinicId,
        userId: actor.id,
        action: "user.created",
        entityType: "User",
        entityId: user.id,
        changes: { role: input.role, clinicId },
      },
    })
    return user.id
  })

  const full = await prisma.user.findUniqueOrThrow({ where: { id: createdId }, include: userInclude })
  return { ok: true, user: toUserDTO(full), tempPassword }
}

export type ManageUserResult = { ok: true } | { ok: false; error: string }

export async function updateUser(actor: AbilitySubject, id: string, input: EditUserInput): Promise<ManageUserResult> {
  const target = await prisma.user.findUnique({ where: { id }, include: { doctor: true } })
  if (!target || !canManageTarget(actor, target)) return { ok: false, error: "User not found." }

  await runWithRls(actor, async (tx) => {
    await tx.user.update({ where: { id }, data: { name: input.name.trim(), phone: input.phone?.trim() || null } })
    if (target.role === "DOCTOR" && target.doctor) {
      await tx.doctor.update({
        where: { userId: id },
        data: {
          licenseNumber: input.licenseNumber?.trim() || target.doctor.licenseNumber,
          specialization: input.specialization?.trim() || target.doctor.specialization,
          consultationFee: input.consultationFeePesos
            ? Math.round(Number(input.consultationFeePesos) * 100)
            : target.doctor.consultationFee,
        },
      })
    }
    await tx.auditLog.create({
      data: { clinicId: target.clinicId, userId: actor.id, action: "user.updated", entityType: "User", entityId: id },
    })
  })
  return { ok: true }
}

export async function setUserActive(actor: AbilitySubject, id: string, isActive: boolean): Promise<ManageUserResult> {
  // Checked before canManageTarget — a clinic admin's own row is a
  // CLINIC_ADMIN, which canManageTarget correctly refuses for anyone
  // *else's* clinic-admin account, but that check running first would
  // reject an admin's own id with the wrong, misleading "not found"
  // instead of the real reason.
  if (id === actor.id) return { ok: false, error: "You can't deactivate your own account." }

  const target = await prisma.user.findUnique({ where: { id } })
  if (!target || !canManageTarget(actor, target)) return { ok: false, error: "User not found." }

  await runWithRls(actor, async (tx) => {
    await tx.user.update({ where: { id }, data: { isActive } })
    await tx.auditLog.create({
      data: {
        clinicId: target.clinicId,
        userId: actor.id,
        action: isActive ? "user.reactivated" : "user.deactivated",
        entityType: "User",
        entityId: id,
      },
    })
  })
  return { ok: true }
}

export async function forcePasswordReset(actor: AbilitySubject, id: string): Promise<ManageUserResult> {
  const target = await prisma.user.findUnique({ where: { id } })
  if (!target || !canManageTarget(actor, target)) return { ok: false, error: "User not found." }

  await runWithRls(actor, async (tx) => {
    await tx.user.update({ where: { id }, data: { mustChangePassword: true } })
    await tx.auditLog.create({
      data: {
        clinicId: target.clinicId,
        userId: actor.id,
        action: "user.password_reset_forced",
        entityType: "User",
        entityId: id,
      },
    })
  })
  return { ok: true }
}

export async function unlockAccount(actor: AbilitySubject, id: string): Promise<ManageUserResult> {
  const target = await prisma.user.findUnique({ where: { id } })
  if (!target || !canManageTarget(actor, target)) return { ok: false, error: "User not found." }

  await runWithRls(actor, async (tx) => {
    await tx.user.update({ where: { id }, data: { failedLoginAttempts: 0, lockedUntil: null } })
    await tx.auditLog.create({
      data: { clinicId: target.clinicId, userId: actor.id, action: "user.unlocked", entityType: "User", entityId: id },
    })
  })
  return { ok: true }
}
