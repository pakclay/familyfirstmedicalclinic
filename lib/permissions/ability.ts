// Single chokepoint for "can this role do this?" — see §4 of the product
// spec for the ability matrix this encodes verbatim.
//
// Phase 0 scope: enough to drive role-aware nav and a first access check.
// Phase 2 adds: scopedPrisma() query scoping, Postgres RLS as a backstop,
// role-aware DTOs, and the Vitest suite that proves a forbidden read 403s
// per role. Do not consider this file "the" security boundary until that
// lands — see DECISIONS.md.

export type Role =
  | "OWNER"
  | "BRANCH_MANAGER"
  | "DOCTOR"
  | "THERAPIST"
  | "FRONT_DESK"
  | "MARKETING"

export type Action = "read" | "write" | "approve"

export type Scope = "none" | "own" | "branch" | "all"

export type Resource =
  | "patientDemographics"
  | "intakeSubmissions"
  | "soapNotes"
  | "prescription"
  | "carePlan"
  | "appointments"
  | "packages"
  | "payments"
  | "quotaSchemes"
  | "payoutResults"
  | "leads"
  | "analyticsDemographics"
  | "analyticsFinancial"
  | "usersAccess"
  | "auditLog"
  | "branchServiceCatalog"

type ResourceRule = {
  read: Scope
  write: Scope
  approve?: true
  /** MARKETING sees demographics/funnel numbers only, never a name or contact. */
  aggregateOnly?: true
  /** FRONT_DESK can record a payment but never list/report on payments. */
  writeOnlyNoReports?: true
}

type Matrix = Record<Resource, Record<Role, ResourceRule>>

const NONE: ResourceRule = { read: "none", write: "none" }

export const ABILITY_MATRIX: Matrix = {
  patientDemographics: {
    OWNER: { read: "all", write: "all" },
    BRANCH_MANAGER: { read: "branch", write: "branch" },
    DOCTOR: { read: "all", write: "none" },
    THERAPIST: { read: "own", write: "none" },
    FRONT_DESK: { read: "branch", write: "branch" },
    MARKETING: NONE,
  },
  intakeSubmissions: {
    OWNER: { read: "all", write: "all" },
    BRANCH_MANAGER: { read: "branch", write: "none" },
    DOCTOR: { read: "all", write: "none" },
    THERAPIST: { read: "own", write: "none" },
    FRONT_DESK: { read: "branch", write: "branch" },
    MARKETING: NONE,
  },
  soapNotes: {
    OWNER: { read: "all", write: "none" },
    BRANCH_MANAGER: NONE,
    DOCTOR: { read: "all", write: "all" },
    THERAPIST: { read: "own", write: "own" },
    FRONT_DESK: NONE,
    MARKETING: NONE,
  },
  prescription: {
    OWNER: { read: "all", write: "none" },
    BRANCH_MANAGER: { read: "branch", write: "none" },
    DOCTOR: { read: "all", write: "all" },
    THERAPIST: { read: "own", write: "none" },
    FRONT_DESK: NONE,
    MARKETING: NONE,
  },
  // Not one of §4.1's table rows — CarePlan sits between prescription and
  // scheduling and isn't named explicitly, but §6 requires assigning one
  // (which sets Patient.primaryTherapistId) and someone has to be allowed
  // to do that. Modeled the same way soapNotes/prescription are: the two
  // roles actually present at that point in the workflow (THERAPIST for
  // WELLNESS triage, DOCTOR right after signing a REHAB prescription) get
  // write access to their own patients; OWNER always can; BRANCH_MANAGER
  // gets read for branch ops visibility, matching its pattern everywhere
  // else in the matrix.
  carePlan: {
    OWNER: { read: "all", write: "all" },
    BRANCH_MANAGER: { read: "branch", write: "none" },
    DOCTOR: { read: "all", write: "all" },
    THERAPIST: { read: "own", write: "own" },
    FRONT_DESK: NONE,
    MARKETING: NONE,
  },
  appointments: {
    OWNER: { read: "all", write: "all" },
    BRANCH_MANAGER: { read: "branch", write: "branch" },
    DOCTOR: { read: "all", write: "none" },
    THERAPIST: { read: "own", write: "own" },
    FRONT_DESK: { read: "branch", write: "branch" },
    MARKETING: NONE,
  },
  packages: {
    OWNER: { read: "all", write: "all" },
    BRANCH_MANAGER: { read: "branch", write: "branch" },
    DOCTOR: { read: "all", write: "none" },
    THERAPIST: { read: "own", write: "none" },
    FRONT_DESK: { read: "branch", write: "branch" },
    MARKETING: NONE,
  },
  payments: {
    OWNER: { read: "all", write: "all" },
    BRANCH_MANAGER: { read: "branch", write: "none" },
    DOCTOR: NONE,
    THERAPIST: NONE,
    FRONT_DESK: { read: "none", write: "branch", writeOnlyNoReports: true },
    MARKETING: NONE,
  },
  quotaSchemes: {
    OWNER: { read: "all", write: "all" },
    BRANCH_MANAGER: { read: "branch", write: "none" },
    DOCTOR: NONE,
    THERAPIST: NONE,
    FRONT_DESK: NONE,
    MARKETING: NONE,
  },
  payoutResults: {
    OWNER: { read: "all", write: "all", approve: true },
    BRANCH_MANAGER: { read: "branch", write: "none" },
    DOCTOR: NONE,
    THERAPIST: { read: "own", write: "none" },
    FRONT_DESK: NONE,
    MARKETING: NONE,
  },
  leads: {
    OWNER: { read: "all", write: "all" },
    BRANCH_MANAGER: { read: "branch", write: "branch" },
    DOCTOR: NONE,
    THERAPIST: NONE,
    FRONT_DESK: { read: "branch", write: "branch" },
    MARKETING: { read: "all", write: "all" },
  },
  analyticsDemographics: {
    OWNER: { read: "all", write: "none" },
    BRANCH_MANAGER: { read: "branch", write: "none" },
    DOCTOR: { read: "all", write: "none" },
    THERAPIST: NONE,
    FRONT_DESK: NONE,
    MARKETING: { read: "all", write: "none", aggregateOnly: true },
  },
  analyticsFinancial: {
    OWNER: { read: "all", write: "none" },
    BRANCH_MANAGER: { read: "branch", write: "none" },
    DOCTOR: NONE,
    THERAPIST: NONE,
    FRONT_DESK: NONE,
    MARKETING: NONE,
  },
  usersAccess: {
    OWNER: { read: "all", write: "all" },
    BRANCH_MANAGER: NONE,
    DOCTOR: NONE,
    THERAPIST: NONE,
    FRONT_DESK: NONE,
    MARKETING: NONE,
  },
  auditLog: {
    OWNER: { read: "all", write: "none" },
    BRANCH_MANAGER: NONE,
    DOCTOR: NONE,
    THERAPIST: NONE,
    FRONT_DESK: NONE,
    MARKETING: NONE,
  },
  branchServiceCatalog: {
    OWNER: { read: "all", write: "all" },
    BRANCH_MANAGER: { read: "all", write: "none" },
    DOCTOR: { read: "all", write: "none" },
    THERAPIST: { read: "all", write: "none" },
    FRONT_DESK: { read: "all", write: "none" },
    MARKETING: { read: "all", write: "none" },
  },
}

export type AbilitySubject = {
  role: Role
  id: string
  homeBranchId: string | null
}

/**
 * A record's ownership shape, for scope checks beyond "does this role touch
 * this resource at all". Only the fields relevant to a given resource need
 * to be present.
 */
export type AbilityRecord = {
  branchId?: string | null
  therapistId?: string | null
  patientOwnerId?: string | null
}

function scopeFor(subject: AbilitySubject, resource: Resource): ResourceRule {
  return ABILITY_MATRIX[resource][subject.role] ?? NONE
}

/**
 * Nav / coarse UI gating: does this role have any access to this resource
 * for this action, ignoring record-level ownership? Use `can()` (with a
 * record) for actual data-access decisions once Phase 2's scoping lands.
 */
export function canAccess(subject: AbilitySubject, resource: Resource, action: Action): boolean {
  const rule = scopeFor(subject, resource)
  if (action === "approve") return rule.approve === true
  const scope = action === "read" ? rule.read : rule.write
  return scope !== "none"
}

/**
 * Record-level check. Pass `record` once you have the row (or its
 * branchId/therapistId) to enforce "own" / "branch" scoping in addition to
 * the coarse resource-level rule.
 */
export function can(
  subject: AbilitySubject,
  action: Action,
  resource: Resource,
  record?: AbilityRecord
): boolean {
  const rule = scopeFor(subject, resource)
  if (action === "approve") return rule.approve === true

  const scope = action === "read" ? rule.read : rule.write
  if (scope === "none") return false
  if (scope === "all") return true
  if (!record) return true // "own"/"branch" scope exists; coarse check when no record supplied

  if (scope === "branch") {
    return !!subject.homeBranchId && record.branchId === subject.homeBranchId
  }
  if (scope === "own") {
    return record.therapistId === subject.id || record.patientOwnerId === subject.id
  }
  return false
}
