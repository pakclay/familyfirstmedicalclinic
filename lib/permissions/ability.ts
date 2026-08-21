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
