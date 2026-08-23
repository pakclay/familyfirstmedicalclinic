import bcrypt from "bcryptjs"
import { prisma } from "@/lib/db/prisma"
import { runWithRls } from "@/lib/db/rls"
import type { AbilitySubject } from "@/lib/permissions/ability"

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
 * real enforcement that a user can only change their own password — the
 * RLS policy on `users` is clinic-scoped, not self-scoped, so without this
 * explicit id filter any front-desk account could overwrite a colleague's
 * password in the same clinic.
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
