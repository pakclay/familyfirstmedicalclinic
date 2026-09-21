import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { eachDayLabel, resolveReportInstantRange } from "@/lib/utils/report-dates"

describe("report date ranges", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // 2026-08-23T01:00:00+08:00 — Manila is already on the 23rd, UTC is
    // still the 22nd, the same edge lib/queries/__tests__/queue-dates.test.ts pins.
    vi.setSystemTime(new Date("2026-08-22T17:00:00.000Z"))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("defaults to the last 30 days ending on the clinic's today", () => {
    const range = resolveReportInstantRange({}, "Asia/Manila")
    expect(range.startLabel).toBe("2026-07-25")
    expect(range.endLabel).toBe("2026-08-23")
    expect(eachDayLabel(range.startLabel, range.endLabel)).toHaveLength(30)
  })

  it("`days` shortens the window, still ending today", () => {
    const range = resolveReportInstantRange({ days: 7 }, "Asia/Manila")
    expect(range.startLabel).toBe("2026-08-17")
    expect(range.endLabel).toBe("2026-08-23")
    expect(eachDayLabel(range.startLabel, range.endLabel)).toHaveLength(7)
  })

  it("an explicit start wins over `days`; a nonsense `days` falls back to 30", () => {
    expect(resolveReportInstantRange({ start: "2026-08-01", days: 7 }, "Asia/Manila").startLabel).toBe("2026-08-01")
    expect(resolveReportInstantRange({ days: 0 }, "Asia/Manila").startLabel).toBe("2026-07-25")
    expect(resolveReportInstantRange({ days: -3 }, "Asia/Manila").startLabel).toBe("2026-07-25")
  })

  it("eachDayLabel walks every calendar day inclusive, across a month boundary", () => {
    expect(eachDayLabel("2026-08-30", "2026-09-02")).toEqual(["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02"])
    expect(eachDayLabel("2026-09-02", "2026-09-02")).toEqual(["2026-09-02"])
  })

  it("eachDayLabel is empty for an inverted or malformed range", () => {
    expect(eachDayLabel("2026-09-02", "2026-09-01")).toEqual([])
    expect(eachDayLabel("yesterday", "2026-09-01")).toEqual([])
  })
})
