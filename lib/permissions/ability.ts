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
  branchId: string | null
  holdingCompanyId: string | null
}

/** HOLDING_ADMIN is the only role not scoped to a single branch. */
export function isHoldingAdmin(user: AbilitySubject): boolean {
  return user.role === "HOLDING_ADMIN"
}

/**
 * The branch id every query for this user must be scoped by. Throws for a
 * holding admin, who by definition isn't scoped to one branch — callers at
 * that boundary should branch on `isHoldingAdmin` first and query across
 * branches (or take an explicit branchId argument) instead of calling this.
 */
export function requireBranchId(user: AbilitySubject): string {
  if (!user.branchId) {
    throw new Error(
      `requireBranchId called for a user with no branchId (role=${user.role}) — branch on isHoldingAdmin first`
    )
  }
  return user.branchId
}

/**
 * The holding company every cross-branch read must be bounded by.
 *
 * A holding admin is unscoped *within* their company, not across companies.
 * `clinics`, `branches`, `users` and `doctors` carry no RLS policy at all
 * (see lib/queries/users.ts's changeOwnPassword comment), so unlike the
 * operational tables there is no database backstop here — an org-wide read
 * that omits this predicate returns every tenant's rows. lib/queries/audit-log.ts
 * already bounds every one of its reads this way for exactly that reason.
 *
 * Throws rather than returning null so a company-less holding admin fails
 * loudly instead of silently widening to the whole database, matching
 * getHoldingConsolidatedReport's guard.
 */
export function requireHoldingCompanyId(user: AbilitySubject): string {
  if (!user.holdingCompanyId) {
    throw new Error(
      `requireHoldingCompanyId called for a user with no holdingCompanyId (role=${user.role}) — a cross-branch read cannot be bounded`
    )
  }
  return user.holdingCompanyId
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
