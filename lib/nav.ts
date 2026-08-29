import type { Role } from "@prisma/client"

export type NavItem = { label: string; href: string }

const CLINIC_ADMIN_NAV: NavItem[] = [
  { label: "Dashboard", href: "/console/dashboard" },
  // lives under /staff — shared with front desk rather than reimplemented
  // per role; proxy.ts already allows CLINIC_ADMIN/HOLDING_ADMIN there.
  { label: "Patients", href: "/staff/patients" },
  { label: "Reports", href: "/console/reports" },
  { label: "Expenses", href: "/console/expenses" },
  // Also under /staff, and branch-scoped for the same reason Patients is: a
  // clinic admin runs one branch. /console/users spans the company and is
  // reachable only through holding-admin screens.
  { label: "Team", href: "/staff/team" },
  { label: "Settings", href: "/console/settings" },
]

const HOLDING_ADMIN_NAV: NavItem[] = [
  { label: "Dashboard", href: "/console/dashboard" },
  // The way into both clinics and accounts: the org tree with staff counts,
  // plus whatever currently needs acting on. /console/users has no nav entry
  // of its own — Administration links into it, and every account row on a
  // clinic or branch page goes straight to the user it names.
  { label: "Administration", href: "/console/admin" },
  { label: "Reports", href: "/console/reports" },
  { label: "Clinics", href: "/console/clinics" },
  { label: "Audit log", href: "/console/audit-log" },
]

export function navForRole(role: Role): NavItem[] {
  if (role === "HOLDING_ADMIN") return HOLDING_ADMIN_NAV
  if (role === "CLINIC_ADMIN") return CLINIC_ADMIN_NAV
  return []
}
