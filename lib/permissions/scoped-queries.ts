import type { AbilitySubject, Resource } from "./ability"
import { ABILITY_MATRIX } from "./ability"

/**
 * Turns a resource's §4.1 read/write scope into a Prisma `where` fragment.
 * Returns `null` when the role has no access at all — callers must treat
 * that as a hard deny (redirect/403), not "no rows".
 *
 * This is Phase 1's version of the "query scoping" piece of §4.2 — narrow
 * to what Patients actually needs (branchField/ownField). Phase 2 widens
 * this into the full scopedPrisma() + RLS + DTO layer for every resource.
 */
export function scopeWhere(
  subject: AbilitySubject,
  resource: Resource,
  action: "read" | "write",
  fields: { branchField: string; ownField?: string }
): Record<string, unknown> | null {
  const rule = ABILITY_MATRIX[resource][subject.role]
  const scope = action === "read" ? rule.read : rule.write
  if (scope === "none") return null
  if (scope === "all") return {}
  if (scope === "branch") {
    if (!subject.homeBranchId) return null
    return { [fields.branchField]: subject.homeBranchId }
  }
  if (scope === "own") {
    if (!fields.ownField) return null
    return { [fields.ownField]: subject.id }
  }
  return null
}
