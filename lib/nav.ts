import type { Role } from "@/lib/permissions/ability"

export type NavItem = {
  label: string
  href: string
  roles: Role[]
}

// Who sees what in the console sidebar. This is deliberately a flat
// allowlist rather than routed through ability.ts — several of these pages
// (e.g. "Therapists" as a staff roster) don't map to a single ability-matrix
// resource. Page- and query-level access still goes through can().
export const NAV_ITEMS: NavItem[] = [
  {
    label: "Dashboard",
    href: "/console/dashboard",
    roles: ["OWNER", "BRANCH_MANAGER", "DOCTOR", "THERAPIST", "FRONT_DESK", "MARKETING"],
  },
  {
    label: "Patients",
    href: "/console/patients",
    roles: ["OWNER", "BRANCH_MANAGER", "DOCTOR", "THERAPIST", "FRONT_DESK"],
  },
  {
    label: "Schedule",
    href: "/console/schedule",
    roles: ["OWNER", "BRANCH_MANAGER", "DOCTOR", "THERAPIST", "FRONT_DESK"],
  },
  {
    label: "Doctor Queue",
    href: "/console/doctor-queue",
    roles: ["OWNER", "DOCTOR"],
  },
  {
    label: "Leads",
    href: "/console/leads",
    roles: ["OWNER", "BRANCH_MANAGER", "FRONT_DESK", "MARKETING"],
  },
  {
    label: "Therapists",
    href: "/console/therapists",
    roles: ["OWNER", "BRANCH_MANAGER", "FRONT_DESK"],
  },
  {
    label: "Payouts",
    href: "/console/payouts",
    roles: ["OWNER", "BRANCH_MANAGER", "THERAPIST"],
  },
  {
    label: "Reports",
    href: "/console/reports",
    roles: ["OWNER", "BRANCH_MANAGER", "MARKETING"],
  },
  {
    label: "Settings",
    href: "/console/settings",
    roles: ["OWNER"],
  },
]

export function navForRole(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role))
}
