import { z } from "zod"

const baseUserFields = {
  name: z.string().trim().min(1, "Name is required"),
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email"),
  phone: z.string().trim().optional(),
  role: z.enum(["FRONT_DESK", "DOCTOR", "CLINIC_ADMIN", "HOLDING_ADMIN"]),
  // Empty string for a clinic admin creating within their own branch — the
  // query layer fills that in; a holding admin must pick one explicitly
  // unless the role is HOLDING_ADMIN, which has no branch at all.
  branchId: z.string().optional(),
}

/**
 * Doctor-specific fields are required only when role === "DOCTOR" — a
 * single object schema can't express "required if this other field has
 * this value" without `.superRefine`, since each field's own `.optional()`
 * has to be able to pass Zod's per-field validation before the refinement
 * runs.
 */
function requireDoctorFieldsIfDoctor(
  v: { role: string; licenseNumber?: string; consultationFeePesos?: string },
  ctx: z.RefinementCtx
) {
  if (v.role !== "DOCTOR") return
  if (!v.licenseNumber?.trim()) {
    ctx.addIssue({ code: "custom", message: "License number is required for a doctor", path: ["licenseNumber"] })
  }
  const fee = Number(v.consultationFeePesos)
  if (!v.consultationFeePesos || !Number.isFinite(fee) || fee <= 0) {
    ctx.addIssue({
      code: "custom",
      message: "Consultation fee is required for a doctor",
      path: ["consultationFeePesos"],
    })
  }
}

export const createUserSchema = z
  .object({
    ...baseUserFields,
    specialization: z.string().trim().optional(),
    licenseNumber: z.string().trim().optional(),
    consultationFeePesos: z.string().trim().optional(),
  })
  .superRefine(requireDoctorFieldsIfDoctor)

export type CreateUserInput = z.infer<typeof createUserSchema>

export const editUserSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  phone: z.string().trim().optional(),
  specialization: z.string().trim().optional(),
  licenseNumber: z.string().trim().optional(),
  consultationFeePesos: z.string().trim().optional(),
  // Which branch the user works at. Optional and absent-means-unchanged, so
  // a form that never renders the picker (a clinic admin's, or a holding
  // admin's own branchless account) can keep posting the same payload it
  // always has. updateUser decides whether the actor may act on it at all.
  branchId: z.string().optional(),
})

export type EditUserInput = z.infer<typeof editUserSchema>
