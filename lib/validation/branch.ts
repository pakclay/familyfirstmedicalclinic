import { z } from "zod"
import { operatingHoursSchema } from "@/lib/validation/operating-hours"

/**
 * Lowercase, hyphen-separated, no leading/trailing/doubled hyphens. The
 * slug lands in public URLs (`/book/{slug}`, `/display/{slug}`), so it's
 * deliberately stricter than a generic "no spaces" rule — anything that
 * would need percent-encoding is rejected up front instead of producing a
 * link that looks broken when it's shared on Facebook.
 */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/

const editableBranchFields = {
  name: z.string().trim().min(1, "Name is required"),
  address: z.string().trim().min(1, "Address is required"),
  city: z.string().trim().min(1, "City is required"),
  phone: z.string().trim().min(1, "Phone is required"),
  // Empty string is what the form sends for "no Facebook page" — accepted
  // as-is and stored as NULL by the query layer, same shape as
  // medicine.ts's optional-date union.
  facebookPageUrl: z.union([z.literal(""), z.string().trim().url("Enter a valid URL")]).optional(),
  timezone: z.string().trim().min(1, "Timezone is required"),
  operatingHours: operatingHoursSchema,
}

export const createBranchSchema = z.object({
  ...editableBranchFields,
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "URL slug is required")
    .regex(SLUG, "Use lowercase letters, numbers and hyphens only"),
})

export type CreateBranchInput = z.infer<typeof createBranchSchema>

/**
 * Everything except the slug — it's immutable once a branch exists.
 * Changing it would break every booking link already shared on the
 * branch's Facebook page, and there's no redirect layer to catch the old
 * one, so the edit form doesn't offer it and this schema won't accept it.
 */
export const editBranchSchema = z.object(editableBranchFields)

export type EditBranchInput = z.infer<typeof editBranchSchema>

/**
 * What a clinic admin may change about their *own* branch — the day-to-day
 * operational details (§4: "clinic hours, services and prices"). Notably
 * absent: `name` (it's on the public booking page and in holding-level
 * reports), `timezone` (queue numbering, report ranges and follow-up dates
 * are all derived from it), and `slug` (immutable everywhere). Those stay
 * holding-admin-only via the /console/clinics surface.
 *
 * Not built by subsetting editBranchSchema with `.omit()` — the omitted
 * keys are exactly the privilege boundary, so listing what's allowed makes
 * a later addition to editableBranchFields fail closed rather than
 * silently widening what a clinic admin can edit.
 */
export const branchSettingsSchema = z.object({
  address: editableBranchFields.address,
  city: editableBranchFields.city,
  phone: editableBranchFields.phone,
  facebookPageUrl: editableBranchFields.facebookPageUrl,
  operatingHours: editableBranchFields.operatingHours,
})

export type BranchSettingsInput = z.infer<typeof branchSettingsSchema>
