import type { Role } from "@prisma/client"

export type NavItem = { label: string; href: string }

/**
 * The two branch-floor navs live here rather than in their layouts because
 * the staff shell has to pick between them: a doctor reaching
 * /staff/inventory (proxy.ts lets them in there, and nowhere else under
 * /staff) must keep the doctor's own nav, or every other link in the header
 * would bounce them straight back to /doctor/queue.
 */
export const STAFF_NAV: NavItem[] = [
  { label: "Queue", href: "/staff/queue" },
  { label: "Register walk-in", href: "/staff/register" },
  { label: "Patients", href: "/staff/patients" },
  { label: "Inventory", href: "/staff/inventory" },
  { label: "Follow-ups", href: "/staff/follow-ups" },
  { label: "Notifications", href: "/staff/notifications" },
  { label: "Remittance", href: "/staff/remittance" },
]

export const DOCTOR_NAV: NavItem[] = [
  { label: "My queue", href: "/doctor/queue" },
  { label: "My collections", href: "/doctor/collections" },
  { label: "Remittance", href: "/doctor/remittance" },
  // Same pages the branch admin uses, under /staff — see proxy.ts.
  { label: "Medicines", href: "/staff/inventory" },
]

const BRANCH_ADMIN_NAV: NavItem[] = [
  { label: "Dashboard", href: "/console/dashboard" },
  // lives under /staff — shared with front desk rather than reimplemented
  // per role; proxy.ts already allows BRANCH_ADMIN/HOLDING_ADMIN there.
  { label: "Patients", href: "/staff/patients" },
  { label: "Reports", href: "/console/reports" },
  { label: "Expenses", href: "/console/expenses" },
  { label: "Users", href: "/console/users" },
  { label: "Settings", href: "/console/settings" },
]

// Two verbs, two entries. No Dashboard: the dashboard's non-branch-admin arm
// renders the holding-admin fallback, whose two links both refuse this role.
// Its home (proxy.ts / app/page.tsx ROLE_HOME) is /console/users instead.
const CLINIC_ADMIN_NAV: NavItem[] = [
  { label: "Users", href: "/console/users" },
  { label: "Branches", href: "/console/clinic" },
]

const HOLDING_ADMIN_NAV: NavItem[] = [
  { label: "Dashboard", href: "/console/dashboard" },
  // Sits above Clinics/Users because it is the way into both: the org tree
  // with staff counts, plus whatever currently needs acting on. Those two
  // stay as the places to work once you know where you are going.
  { label: "Administration", href: "/console/admin" },
  { label: "Reports", href: "/console/reports" },
  { label: "Clinics", href: "/console/clinics" },
  { label: "Users", href: "/console/users" },
  { label: "Audit log", href: "/console/audit-log" },
]

export function navForRole(role: Role): NavItem[] {
  if (role === "HOLDING_ADMIN") return HOLDING_ADMIN_NAV
  if (role === "CLINIC_ADMIN") return CLINIC_ADMIN_NAV
  if (role === "BRANCH_ADMIN") return BRANCH_ADMIN_NAV
  if (role === "DOCTOR") return DOCTOR_NAV
  if (role === "FRONT_DESK") return STAFF_NAV
  return []
}
