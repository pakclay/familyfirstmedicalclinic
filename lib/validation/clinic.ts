import { z } from "zod"

/**
 * The seven keys of the `clinics.operating_hours` JSON column, in display
 * order. Exported so the DTO normalizer and both clinic forms iterate the
 * same list rather than each hard-coding their own — a mismatch there
 * would silently drop a day's hours on save.
 */
export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const
export type Weekday = (typeof WEEKDAYS)[number]

export const WEEKDAY_LABEL: Record<Weekday, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
}

/** 24-hour "HH:MM" — what <input type="time"> produces natively. */
const TIME_24H = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * Lowercase, hyphen-separated, no leading/trailing/doubled hyphens. The
 * slug lands in public URLs (`/book/{slug}`, `/display/{slug}`), so it's
 * deliberately stricter than a generic "no spaces" rule — anything that
 * would need percent-encoding is rejected up front instead of producing a
 * link that looks broken when it's shared on Facebook.
 */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/

/**
 * One weekday's hours, or null when the clinic is closed that day.
 * Zero-padded "HH:MM" compares correctly as a plain string, so the
 * open-before-close check needs no time parsing at all.
 */
const dayHoursSchema = z
  .object({
    open: z.string().trim().regex(TIME_24H, "Enter opening time as HH:MM"),
    close: z.string().trim().regex(TIME_24H, "Enter closing time as HH:MM"),
  })
  .nullable()
  .refine((v) => v === null || v.open < v.close, {
    message: "A day's closing time must be after its opening time",
  })

export const operatingHoursSchema = z.object({
  mon: dayHoursSchema,
  tue: dayHoursSchema,
  wed: dayHoursSchema,
  thu: dayHoursSchema,
  fri: dayHoursSchema,
  sat: dayHoursSchema,
  sun: dayHoursSchema,
})

export type DayHours = { open: string; close: string }
export type OperatingHours = z.infer<typeof operatingHoursSchema>

const editableClinicFields = {
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

export const createClinicSchema = z.object({
  ...editableClinicFields,
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "URL slug is required")
    .regex(SLUG, "Use lowercase letters, numbers and hyphens only"),
})

export type CreateClinicInput = z.infer<typeof createClinicSchema>

/**
 * Everything except the slug — it's immutable once a clinic exists.
 * Changing it would break every booking link already shared on the
 * clinic's Facebook page, and there's no redirect layer to catch the old
 * one, so the edit form doesn't offer it and this schema won't accept it.
 */
export const editClinicSchema = z.object(editableClinicFields)

export type EditClinicInput = z.infer<typeof editClinicSchema>
