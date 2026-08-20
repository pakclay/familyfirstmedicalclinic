import { fromZonedTime, toZonedTime } from "date-fns-tz"

// Reused verbatim by the front-desk booking flow (Phase 3) and the public
// booking flow (Phase 7) — see §9: "Availability = therapist working hours
// − time off − existing appointments − room capacity, in Asia/Manila."
export const APP_TIMEZONE = "Asia/Manila"

export type WeeklyAvailabilityWindow = {
  dayOfWeek: number // 0=Sunday..6=Saturday, matching JS Date#getDay()
  startTime: string // "HH:mm", 24-hour, local (Manila) wall-clock time
  endTime: string // "HH:mm"
}

export type Interval = { start: Date; end: Date }

export type ComputeSlotsParams = {
  /** Any instant on the target civil day — the Manila calendar date is derived from it. */
  date: Date
  /** Already filtered to the relevant therapist + branch + effective date range. */
  weeklyAvailability: WeeklyAvailabilityWindow[]
  timeOff: Interval[]
  /** Existing appointments for this therapist (and/or room) that could conflict — CANCELLED/NO_SHOW excluded by the caller. */
  busy: Interval[]
  serviceDurationMin: number
  slotIntervalMin?: number
  minLeadTimeHours?: number
  now?: Date
}

function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end
}

function parseTimeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number)
  return h * 60 + m
}

/**
 * Slot generation for a single civil day. Pure function — no I/O — so
 * Phase 7's public booking page and the front-desk booking form can share
 * it, and both can be unit tested without a database.
 */
export function computeAvailableSlots(params: ComputeSlotsParams): Interval[] {
  const {
    date,
    weeklyAvailability,
    timeOff,
    busy,
    serviceDurationMin,
    slotIntervalMin = 30,
    minLeadTimeHours = 2,
    now = new Date(),
  } = params

  // toZonedTime shifts the instant so that its UTC-* getters read as the
  // target zone's wall-clock time — using the plain (non-UTC) getters here
  // would silently depend on the runtime's own system timezone matching
  // Asia/Manila, which happens to be true on this dev machine but is not
  // guaranteed anywhere else (e.g. Vercel functions default to UTC).
  const zonedDate = toZonedTime(date, APP_TIMEZONE)
  const dayOfWeek = zonedDate.getUTCDay()
  const dateKey = `${zonedDate.getUTCFullYear()}-${String(zonedDate.getUTCMonth() + 1).padStart(2, "0")}-${String(
    zonedDate.getUTCDate()
  ).padStart(2, "0")}`

  const windows = weeklyAvailability.filter((w) => w.dayOfWeek === dayOfWeek)
  if (windows.length === 0) return []

  const earliestStart = new Date(now.getTime() + minLeadTimeHours * 60 * 60 * 1000)

  const slots: Interval[] = []

  for (const window of windows) {
    const windowStartMin = parseTimeToMinutes(window.startTime)
    const windowEndMin = parseTimeToMinutes(window.endTime)

    for (let slotStartMin = windowStartMin; slotStartMin + serviceDurationMin <= windowEndMin; slotStartMin += slotIntervalMin) {
      const slotEndMin = slotStartMin + serviceDurationMin
      const start = fromZonedTime(`${dateKey}T${minutesToHHmm(slotStartMin)}:00`, APP_TIMEZONE)
      const end = fromZonedTime(`${dateKey}T${minutesToHHmm(slotEndMin)}:00`, APP_TIMEZONE)

      if (start < earliestStart) continue
      if (timeOff.some((t) => overlaps({ start, end }, t))) continue
      if (busy.some((b) => overlaps({ start, end }, b))) continue

      slots.push({ start, end })
    }
  }

  return slots.sort((a, b) => a.start.getTime() - b.start.getTime())
}

function minutesToHHmm(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

/** True if `candidate` conflicts with anything already on the books. Used
 * both for showing available slots and for the transactional re-check at
 * insert time (§9) so a race between two bookings can't double-book. */
export function hasConflict(candidate: Interval, busy: Interval[]): boolean {
  return busy.some((b) => overlaps(candidate, b))
}
