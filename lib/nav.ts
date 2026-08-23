import type { Role } from "@prisma/client"

export type NavItem = { label: string; href: string }

const CLINIC_ADMIN_NAV: NavItem[] = [
  { label: "Dashboard", href: "/console/dashboard" },
  // lives under /staff — shared with front desk rather than reimplemented
  // per role; proxy.ts already allows CLINIC_ADMIN/HOLDING_ADMIN there.
  { label: "Patients", href: "/staff/patients" },
  { label: "Reports", href: "/console/reports" },
  { label: "Expenses", href: "/console/expenses" },
  { label: "Users", href: "/console/users" },
  { label: "Settings", href: "/console/settings" },
]

const HOLDING_ADMIN_NAV: NavItem[] = [
  { label: "Dashboard", href: "/console/dashboard" },
  { label: "Reports", href: "/console/reports" },
  { label: "Clinics", href: "/console/clinics" },
  { label: "Users", href: "/console/users" },
  { label: "Audit log", href: "/console/audit-log" },
]

export function navForRole(role: Role): NavItem[] {
  if (role === "HOLDING_ADMIN") return HOLDING_ADMIN_NAV
  if (role === "CLINIC_ADMIN") return CLINIC_ADMIN_NAV
  return []
}
