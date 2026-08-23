import type { Role } from "@prisma/client"

/**
 * The acting user, as derived from the authenticated session — never from
 * a client-supplied parameter. Every query-layer function takes this
 * explicitly (rather than reading the session itself) so it can be called
 * directly from tests with a fabricated subject, hitting the real database
 * and RLS policies without needing a fake Next.js request/cookie/session.
 */
export type AbilitySubject = {
  id: string
  role: Role
  clinicId: string | null
  holdingCompanyId: string | null
}

/** HOLDING_ADMIN is the only role not scoped to a single clinic. */
export function isHoldingAdmin(user: AbilitySubject): boolean {
  return user.role === "HOLDING_ADMIN"
}

/**
 * The clinic id every query for this user must be scoped by. Throws for a
 * holding admin, who by definition isn't scoped to one clinic — callers at
 * that boundary should branch on `isHoldingAdmin` first and query across
 * clinics (or take an explicit clinicId argument) instead of calling this.
 */
export function requireClinicId(user: AbilitySubject): string {
  if (!user.clinicId) {
    throw new Error(
      `requireClinicId called for a user with no clinicId (role=${user.role}) — branch on isHoldingAdmin first`
    )
  }
  return user.clinicId
}

/**
 * Which roles `actor` is allowed to create or edit — §4's role table:
 * holding admin manages all users, clinic admin manages "doctors and
 * staff" in their own clinic only (not other admins). Deliberately a
 * fixed list per role rather than a general permission check, since
 * user-management is the one place a wrong answer here lets someone
 * mint an account with more access than they have themselves.
 */
export function assignableRoles(actor: AbilitySubject): Role[] {
  if (actor.role === "HOLDING_ADMIN") return ["FRONT_DESK", "DOCTOR", "CLINIC_ADMIN", "HOLDING_ADMIN"]
  if (actor.role === "CLINIC_ADMIN") return ["FRONT_DESK", "DOCTOR"]
  return []
}

export function canManageRole(actor: AbilitySubject, targetRole: Role): boolean {
  return assignableRoles(actor).includes(targetRole)
}
