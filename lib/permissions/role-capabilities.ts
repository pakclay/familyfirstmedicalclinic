import type { Role } from "@prisma/client"

/**
 * What each role can actually do, as data.
 *
 * Written to be shown to a holding admin before they change someone's role,
 * because "CLINIC_ADMIN" on its own does not tell you that the person will
 * lose the consultation screen or gain the ability to confirm remittances.
 *
 * This is a description of the enforcement, never the enforcement itself —
 * every line here corresponds to a check that lives in the query layer, and
 * the query layer is what actually refuses. If the two drift, the query
 * layer is right and this file is stale. Each entry names where the real
 * check lives so it can be confirmed rather than trusted.
 */

export type RoleCapability = { label: string; enforcedIn: string }

export type RoleProfile = {
  role: Role
  label: string
  /** One line an admin can act on, not a definition. */
  summary: string
  scope: "branch" | "company"
  /** Which top-level sections the route gate lets them reach (proxy.ts). */
  sections: string[]
  can: RoleCapability[]
  cannot: RoleCapability[]
}

/**
 * Keyed by `Role` so the compiler demands a profile for every member of the
 * enum. Previously this was a plain array and `roleProfile` threw at runtime
 * for anything missing — which meant adding a role compiled cleanly and then
 * crashed /console/users/[id]/role, the one screen whose entire job is
 * explaining what a role means.
 *
 * Declaration order is the display order: `ROLE_PROFILES` below is derived
 * from this object's values, and JavaScript preserves insertion order for
 * non-numeric string keys. Ordered least to most privileged.
 */
const PROFILE_BY_ROLE: Record<Role, RoleProfile> = {
  FRONT_DESK: {
    role: "FRONT_DESK",
    label: "Front desk",
    summary: "Runs the queue at one branch — check-in, vitals, payments, remittance.",
    scope: "branch",
    sections: ["/staff"],
    can: [
      { label: "Register patients and check them in", enforcedIn: "lib/queries/queue.ts" },
      { label: "Record triage vitals", enforcedIn: "lib/queries/vitals.ts" },
      { label: "Take payments and submit their own remittance", enforcedIn: "lib/queries/remittance.ts" },
      { label: "Send follow-up reminders", enforcedIn: "lib/queries/notifications.ts" },
    ],
    cannot: [
      { label: "Open or save a consultation", enforcedIn: "lib/queries/consultations.ts" },
      { label: "Edit the medicine catalog or receive stock", enforcedIn: "lib/queries/inventory.ts" },
      { label: "Confirm anyone's remittance", enforcedIn: "lib/queries/remittance.ts" },
      { label: "Manage accounts", enforcedIn: "lib/permissions/ability.ts" },
    ],
  },
  DOCTOR: {
    role: "DOCTOR",
    label: "Doctor",
    summary: "Sees patients at one branch. The only role that can record a consultation.",
    scope: "branch",
    sections: ["/doctor"],
    can: [
      { label: "Open the consultation screen", enforcedIn: "lib/queries/consultations.ts" },
      { label: "Save consultations, dispense and prescribe", enforcedIn: "lib/queries/consultations.ts" },
      { label: "Record triage vitals", enforcedIn: "lib/queries/vitals.ts" },
    ],
    cannot: [
      { label: "Reach the staff queue board or the console", enforcedIn: "proxy.ts" },
      { label: "Take payments or submit remittance", enforcedIn: "lib/queries/remittance.ts" },
      { label: "Manage accounts", enforcedIn: "lib/permissions/ability.ts" },
    ],
  },
  CLINIC_ADMIN: {
    role: "CLINIC_ADMIN",
    label: "Clinic admin",
    summary: "Runs one branch: its staff, stock, expenses and reports. Not the whole clinic.",
    scope: "branch",
    sections: ["/staff", "/console"],
    can: [
      { label: "Everything front desk can do", enforcedIn: "proxy.ts" },
      { label: "Create and manage front desk / doctor accounts in their own branch", enforcedIn: "lib/permissions/ability.ts" },
      { label: "Edit the medicine catalog, receive stock, run physical counts", enforcedIn: "lib/queries/inventory.ts" },
      { label: "Record expenses and confirm remittances", enforcedIn: "lib/queries/expenses.ts" },
      { label: "See their own branch's report", enforcedIn: "lib/queries/reports/clinic.ts" },
    ],
    cannot: [
      { label: "Create another admin, or touch any account outside their branch", enforcedIn: "lib/permissions/ability.ts" },
      { label: "Create or edit clinics and branches", enforcedIn: "lib/queries/clinics.ts" },
      { label: "See the audit log or the consolidated report", enforcedIn: "lib/queries/audit-log.ts" },
      { label: "Open a consultation", enforcedIn: "lib/queries/consultations.ts" },
    ],
  },
  HOLDING_ADMIN: {
    role: "HOLDING_ADMIN",
    label: "Holding admin",
    summary: "The whole company. Not attached to any branch, and the only role that spans them.",
    scope: "company",
    sections: ["/staff", "/console"],
    can: [
      { label: "Create and edit clinics and branches", enforcedIn: "lib/queries/clinics.ts" },
      { label: "Manage every account in the company, including other admins", enforcedIn: "lib/permissions/ability.ts" },
      { label: "Move a user between branches, and change roles", enforcedIn: "lib/queries/users.ts" },
      { label: "See the audit log and the consolidated report", enforcedIn: "lib/queries/audit-log.ts" },
      { label: "Read across every branch — satisfies every RLS policy", enforcedIn: "prisma/migrations/…branch_rewrite_rls_policies" },
    ],
    cannot: [
      { label: "Open a consultation, or record vitals", enforcedIn: "lib/queries/vitals.ts" },
      { label: "Work a queue — they have no branch to work in", enforcedIn: "lib/queries/queue.ts" },
      { label: "Reach another holding company's data", enforcedIn: "lib/permissions/ability.ts" },
    ],
  },
}

/** The profiles in display order — least to most privileged. */
export const ROLE_PROFILES: RoleProfile[] = Object.values(PROFILE_BY_ROLE)

/**
 * The compiler guarantees a profile for every `Role`, so this can only fail
 * for a value that reached us as a role without being one — a stale row read
 * from the database after an enum member is removed, say. Kept as a throw
 * rather than a fallback: rendering "unknown role" on the screen that
 * explains permissions would be worse than failing.
 */
export function roleProfile(role: Role): RoleProfile {
  const found = PROFILE_BY_ROLE[role]
  if (!found) throw new Error(`No capability profile for role ${role}`)
  return found
}
