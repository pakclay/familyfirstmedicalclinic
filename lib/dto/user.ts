import type { User, Doctor, Role } from "@prisma/client"

/**
 * Display names for the Role enum, shared by every UI that renders a role.
 *
 * Keyed by `Role` rather than `string` so adding a member to the enum is a
 * build error here instead of `undefined` appearing in the eight screens
 * that render a role name. A role registry that silently tolerates a
 * missing entry is the kind of thing you only notice in production.
 */
export const ROLE_LABEL: Record<Role, string> = {
  FRONT_DESK: "Front desk",
  DOCTOR: "Doctor",
  CLINIC_ADMIN: "Clinic admin",
  HOLDING_ADMIN: "Holding admin",
}

/**
 * Explicit field allowlist — deliberately excludes passwordHash,
 * failedLoginAttempts, and lockedUntil, none of which any UI needs to
 * display (lockedUntil's *presence* matters for the "unlock account"
 * action, so that one's included as a boolean, not the raw timestamp).
 */
export type UserDTO = {
  id: string
  name: string
  email: string
  phone: string | null
  role: User["role"]
  branchId: string | null
  branchName: string | null
  isActive: boolean
  mustChangePassword: boolean
  isLockedOut: boolean
  createdAt: Date
  doctor: { licenseNumber: string; specialization: string; consultationFeePesos: number } | null
}

export function toUserDTO(
  user: User & { branch: { name: string } | null; doctor: Doctor | null }
): UserDTO {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    branchId: user.branchId,
    branchName: user.branch?.name ?? null,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    isLockedOut: user.lockedUntil !== null && user.lockedUntil.getTime() > Date.now(),
    createdAt: user.createdAt,
    doctor: user.doctor
      ? {
          licenseNumber: user.doctor.licenseNumber,
          specialization: user.doctor.specialization,
          consultationFeePesos: user.doctor.consultationFee / 100,
        }
      : null,
  }
}
