import { describe, expect, it } from "vitest"
import { fromZonedTime } from "date-fns-tz"
import { computeAvailableSlots, hasConflict, APP_TIMEZONE, type Interval } from "../availability"

// A Tuesday in Manila time throughout, so dayOfWeek math is unambiguous.
const TUESDAY = fromZonedTime("2026-08-25T12:00:00", APP_TIMEZONE)
const NOW = fromZonedTime("2026-08-24T08:00:00", APP_TIMEZONE) // Monday morning, well before

const NINE_TO_SIX = [{ dayOfWeek: 2, startTime: "09:00", endTime: "18:00" }] // Tuesday

describe("computeAvailableSlots", () => {
  it("returns nothing on a day the therapist has no availability window", () => {
    const slots = computeAvailableSlots({
      date: TUESDAY,
      weeklyAvailability: [{ dayOfWeek: 3, startTime: "09:00", endTime: "18:00" }], // Wednesday only
      timeOff: [],
      busy: [],
      serviceDurationMin: 60,
      now: NOW,
    })
    expect(slots).toHaveLength(0)
  })

  it("generates slots stepping through the window at the given interval", () => {
    const slots = computeAvailableSlots({
      date: TUESDAY,
      weeklyAvailability: NINE_TO_SIX,
      timeOff: [],
      busy: [],
      serviceDurationMin: 60,
      slotIntervalMin: 60,
      now: NOW,
    })
    // 09:00 through 17:00 start times fit a 60-min session in a 9-6 window, stepping hourly = 9 slots
    expect(slots).toHaveLength(9)
    expect(slots[0].start.toISOString()).toBe(fromZonedTime("2026-08-25T09:00:00", APP_TIMEZONE).toISOString())
    expect(slots.at(-1)!.start.toISOString()).toBe(fromZonedTime("2026-08-25T17:00:00", APP_TIMEZONE).toISOString())
  })

  it("never offers a slot that would run past the end of the availability window", () => {
    const slots = computeAvailableSlots({
      date: TUESDAY,
      weeklyAvailability: NINE_TO_SIX,
      timeOff: [],
      busy: [],
      serviceDurationMin: 90,
      slotIntervalMin: 30,
      now: NOW,
    })
    for (const slot of slots) {
      expect(slot.end.getTime()).toBeLessThanOrEqual(fromZonedTime("2026-08-25T18:00:00", APP_TIMEZONE).getTime())
    }
  })

  it("excludes slots overlapping time off", () => {
    const timeOff: Interval[] = [
      { start: fromZonedTime("2026-08-25T12:00:00", APP_TIMEZONE), end: fromZonedTime("2026-08-25T14:00:00", APP_TIMEZONE) },
    ]
    const slots = computeAvailableSlots({
      date: TUESDAY,
      weeklyAvailability: NINE_TO_SIX,
      timeOff,
      busy: [],
      serviceDurationMin: 60,
      slotIntervalMin: 60,
      now: NOW,
    })
    const noon = fromZonedTime("2026-08-25T12:00:00", APP_TIMEZONE).getTime()
    const one = fromZonedTime("2026-08-25T13:00:00", APP_TIMEZONE).getTime()
    expect(slots.some((s) => s.start.getTime() === noon)).toBe(false)
    expect(slots.some((s) => s.start.getTime() === one)).toBe(false)
  })

  it("excludes slots overlapping an existing appointment, even with a different start time", () => {
    // Busy 10:00-11:00. A 60-min session starting at 10:30 would overlap
    // even though it doesn't share an exact start time with the busy slot —
    // this is exactly the case a naive unique-constraint-only guard misses.
    const busy: Interval[] = [
      { start: fromZonedTime("2026-08-25T10:00:00", APP_TIMEZONE), end: fromZonedTime("2026-08-25T11:00:00", APP_TIMEZONE) },
    ]
    const slots = computeAvailableSlots({
      date: TUESDAY,
      weeklyAvailability: NINE_TO_SIX,
      timeOff: [],
      busy,
      serviceDurationMin: 60,
      slotIntervalMin: 30,
      now: NOW,
    })
    const tenThirty = fromZonedTime("2026-08-25T10:30:00", APP_TIMEZONE).getTime()
    expect(slots.some((s) => s.start.getTime() === tenThirty)).toBe(false)
    // But 09:00-10:00 and 11:00-12:00 are fine — they touch the busy block's
    // edges without overlapping it.
    const nine = fromZonedTime("2026-08-25T09:00:00", APP_TIMEZONE).getTime()
    const eleven = fromZonedTime("2026-08-25T11:00:00", APP_TIMEZONE).getTime()
    expect(slots.some((s) => s.start.getTime() === nine)).toBe(true)
    expect(slots.some((s) => s.start.getTime() === eleven)).toBe(true)
  })

  it("respects the minimum lead time", () => {
    const nowIsNoonTuesday = fromZonedTime("2026-08-25T12:00:00", APP_TIMEZONE)
    const slots = computeAvailableSlots({
      date: TUESDAY,
      weeklyAvailability: NINE_TO_SIX,
      timeOff: [],
      busy: [],
      serviceDurationMin: 60,
      slotIntervalMin: 60,
      minLeadTimeHours: 2,
      now: nowIsNoonTuesday,
    })
    // earliest bookable is 14:00; 13:00 must be excluded even though the window covers it
    const onePm = fromZonedTime("2026-08-25T13:00:00", APP_TIMEZONE).getTime()
    expect(slots.some((s) => s.start.getTime() === onePm)).toBe(false)
    const twoPm = fromZonedTime("2026-08-25T14:00:00", APP_TIMEZONE).getTime()
    expect(slots.some((s) => s.start.getTime() === twoPm)).toBe(true)
  })
})

describe("hasConflict", () => {
  it("detects an overlap regardless of exact start-time alignment", () => {
    const busy: Interval[] = [
      { start: fromZonedTime("2026-08-25T10:00:00", APP_TIMEZONE), end: fromZonedTime("2026-08-25T11:00:00", APP_TIMEZONE) },
    ]
    const candidate: Interval = {
      start: fromZonedTime("2026-08-25T10:45:00", APP_TIMEZONE),
      end: fromZonedTime("2026-08-25T11:45:00", APP_TIMEZONE),
    }
    expect(hasConflict(candidate, busy)).toBe(true)
  })

  it("touching intervals (end === start) don't count as a conflict", () => {
    const busy: Interval[] = [
      { start: fromZonedTime("2026-08-25T10:00:00", APP_TIMEZONE), end: fromZonedTime("2026-08-25T11:00:00", APP_TIMEZONE) },
    ]
    const candidate: Interval = {
      start: fromZonedTime("2026-08-25T11:00:00", APP_TIMEZONE),
      end: fromZonedTime("2026-08-25T12:00:00", APP_TIMEZONE),
    }
    expect(hasConflict(candidate, busy)).toBe(false)
  })
})
