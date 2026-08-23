import type { Clinic } from "@prisma/client"
import { WEEKDAYS, type DayHours, type OperatingHours, type Weekday } from "@/lib/validation/clinic"

/**
 * Explicit field allowlist — no raw Prisma row ever reaches a component.
 * Deliberately excludes holdingCompanyId (an internal FK the UI has no use
 * for; there's exactly one holding company in this app's data model) and
 * updatedAt.
 */
export type ClinicDTO = {
  id: string
  name: string
  slug: string
  address: string
  city: string
  phone: string
  facebookPageUrl: string | null
  timezone: string
  operatingHours: OperatingHours
  isActive: boolean
  createdAt: Date
}

/**
 * `operating_hours` is an untyped JSON column, so rows written before this
 * feature existed (the seed, test fixtures with `{}`) can hold anything.
 * Normalize rather than cast: every weekday key is present in the result,
 * and anything unrecognized becomes "closed" instead of throwing on a page
 * render. Never returns a shape the forms can't display.
 */
function normalizeOperatingHours(value: Clinic["operatingHours"]): OperatingHours {
  const source =
    value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

  const hours = {} as Record<Weekday, DayHours | null>
  for (const day of WEEKDAYS) {
    const entry = source[day]
    if (entry !== null && typeof entry === "object" && !Array.isArray(entry)) {
      const { open, close } = entry as { open?: unknown; close?: unknown }
      if (typeof open === "string" && typeof close === "string") {
        hours[day] = { open, close }
        continue
      }
    }
    hours[day] = null
  }
  return hours
}

export function toClinicDTO(clinic: Clinic): ClinicDTO {
  return {
    id: clinic.id,
    name: clinic.name,
    slug: clinic.slug,
    address: clinic.address,
    city: clinic.city,
    phone: clinic.phone,
    facebookPageUrl: clinic.facebookPageUrl,
    timezone: clinic.timezone,
    operatingHours: normalizeOperatingHours(clinic.operatingHours),
    isActive: clinic.isActive,
    createdAt: clinic.createdAt,
  }
}
