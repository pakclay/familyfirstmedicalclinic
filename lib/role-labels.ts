import type { Role } from "@/lib/permissions/ability"

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: "Owner",
  BRANCH_MANAGER: "Branch Manager",
  DOCTOR: "Doctor",
  THERAPIST: "Therapist",
  FRONT_DESK: "Front Desk",
  MARKETING: "Marketing",
}
