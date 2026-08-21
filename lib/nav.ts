import type { Role } from "@prisma/client"

export type NavItem = { label: string; href: string }

const CONSOLE_NAV: NavItem[] = [
  { label: "Dashboard", href: "/console/dashboard" },
  // lives under /staff — shared with front desk rather than reimplemented
  // per role; middleware already allows CLINIC_ADMIN/HOLDING_ADMIN there.
  { label: "Patients", href: "/staff/patients" },
]

const HOLDING_ONLY_NAV: NavItem[] = [
  { label: "Clinics", href: "/console/clinics" },
  { label: "Users", href: "/console/users" },
  { label: "Audit log", href: "/console/audit-log" },
]

export function navForRole(role: Role): NavItem[] {
  if (role === "HOLDING_ADMIN") return [...CONSOLE_NAV, ...HOLDING_ONLY_NAV]
  if (role === "CLINIC_ADMIN") return CONSOLE_NAV
  return []
}
