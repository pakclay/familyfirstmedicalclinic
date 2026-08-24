import type { Branch } from "@prisma/client"
import { WEEKDAYS, type DayHours, type OperatingHours, type Weekday } from "@/lib/validation/operating-hours"

/**
 * Explicit field allowlist — no raw Prisma row ever reaches a component.
 * `clinicName` is carried alongside `clinicId` so list/report UIs can
 * label a branch under its clinic without a second round trip.
 */
export type BranchDTO = {
  id: string
  clinicId: string
  clinicName: string
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
export function normalizeOperatingHours(value: Branch["operatingHours"]): OperatingHours {
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

export function toBranchDTO(branch: Branch & { clinic: { name: string } }): BranchDTO {
  return {
    id: branch.id,
    clinicId: branch.clinicId,
    clinicName: branch.clinic.name,
    name: branch.name,
    slug: branch.slug,
    address: branch.address,
    city: branch.city,
    phone: branch.phone,
    facebookPageUrl: branch.facebookPageUrl,
    timezone: branch.timezone,
    operatingHours: normalizeOperatingHours(branch.operatingHours),
    isActive: branch.isActive,
    createdAt: branch.createdAt,
  }
}
