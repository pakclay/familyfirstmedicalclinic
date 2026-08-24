import { z } from "zod"

/**
 * Clinic is purely organizational after the branch-hierarchy migration —
 * see DECISIONS.md. Everything operational (slug, address, hours, ...)
 * moved to Branch (lib/validation/branch.ts).
 */
const editableClinicFields = {
  name: z.string().trim().min(1, "Name is required"),
}

export const createClinicSchema = z.object(editableClinicFields)
export type CreateClinicInput = z.infer<typeof createClinicSchema>

export const editClinicSchema = z.object(editableClinicFields)
export type EditClinicInput = z.infer<typeof editClinicSchema>
