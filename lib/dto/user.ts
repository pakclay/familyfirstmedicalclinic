import type { User, Doctor } from "@prisma/client"

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
