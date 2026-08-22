import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { todayAsQueueDate, tomorrowAsQueueDate, todayInstantRange } from "@/lib/queries/queue"

/**
 * Regression coverage for a real bug found while manually walking through
 * DEMO.md: these functions pair `toZonedTime`/`fromZonedTime` (date-fns-tz
 * 3.x) with the wrong kind of getter, which happened to produce the right
 * answer only when the machine running the app has its own local timezone
 * set to UTC — true of most CI/container defaults, false of a developer's
 * own machine or a host explicitly configured otherwise. Pinning the clock
 * here (rather than relying on whatever instant the test happens to run
 * at) is what makes this reproducible regardless of the host's timezone.
 */
describe("queue date helpers", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // 2026-08-23T01:00:00+08:00 — Manila's calendar date has already
    // ticked over to the 23rd, but UTC's hasn't (it's still the 22nd).
    // This is exactly the window the bug silently mishandled.
    vi.setSystemTime(new Date("2026-08-22T17:00:00.000Z"))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("todayAsQueueDate reads the clinic's own calendar date, not UTC's", () => {
    expect(todayAsQueueDate("Asia/Manila").toISOString()).toBe("2026-08-23T00:00:00.000Z")
  })

  it("tomorrowAsQueueDate is exactly one calendar day after today", () => {
    expect(tomorrowAsQueueDate("Asia/Manila").toISOString()).toBe("2026-08-24T00:00:00.000Z")
  })

  it("todayInstantRange bounds the real UTC instants of Manila midnight-to-midnight", () => {
    const { start, end } = todayInstantRange("Asia/Manila")
    // Manila midnight (the 23rd) is UTC 16:00 the day before.
    expect(start.toISOString()).toBe("2026-08-22T16:00:00.000Z")
    expect(end.toISOString()).toBe("2026-08-23T16:00:00.000Z")
  })

  it("holds for a timezone behind UTC too, not just one that happens to match this host", () => {
    // New York (UTC-4 in August, EDT): local calendar date is still the
    // 22nd at this same instant, one day behind Manila's.
    expect(todayAsQueueDate("America/New_York").toISOString()).toBe("2026-08-22T00:00:00.000Z")
    const { start } = todayInstantRange("America/New_York")
    expect(start.toISOString()).toBe("2026-08-22T04:00:00.000Z")
  })
})
