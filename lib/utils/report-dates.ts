import { fromZonedTime, toZonedTime } from "date-fns-tz"

export type DateRangeParams = {
  start?: string // "YYYY-MM-DD"
  end?: string // "YYYY-MM-DD"
  /**
   * How many days the window covers when `start` is unset — ending today,
   * inclusive. The reports leave it at the 30-day default; the dashboard
   * asks for 7. An explicit `start` always wins over this.
   */
  days?: number
}

const DEFAULT_WINDOW_DAYS = 30

function parseDateOnly(value: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  return { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) }
}

function toLabel(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`
}

/**
 * Resolves a report's date-range query params into the real UTC instants
 * bounding that range *in the clinic's own timezone* — for filtering real
 * timestamp columns (`Payment.receivedAt`, `Consultation.createdAt`, …).
 * Defaults to the last `days` days (30 unless asked otherwise), inclusive
 * of today, when `start` is unset. See `todayInstantRange` in
 * lib/queries/queue.ts for why this can't just use UTC-midnight labels
 * directly, and for why `fromZonedTime`'s input below is built with the
 * plain `Date` constructor rather than `Date.UTC`.
 */
export function resolveReportInstantRange(params: DateRangeParams, timezone: string): { start: Date; end: Date; startLabel: string; endLabel: string } {
  // toZonedTime's result must be read with plain (non-UTC) getters — see
  // todayAsQueueDate in lib/queries/queue.ts for why.
  const now = toZonedTime(new Date(), timezone)
  const defaultEnd = { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() }
  const windowDays = params.days !== undefined && params.days >= 1 ? Math.floor(params.days) : DEFAULT_WINDOW_DAYS
  const windowStart = new Date(Date.UTC(defaultEnd.y, defaultEnd.m, defaultEnd.d - (windowDays - 1)))
  const defaultStart = { y: windowStart.getUTCFullYear(), m: windowStart.getUTCMonth(), d: windowStart.getUTCDate() }

  const startParts = (params.start && parseDateOnly(params.start)) || defaultStart
  const endParts = (params.end && parseDateOnly(params.end)) || defaultEnd

  const startLocalMidnight = new Date(startParts.y, startParts.m, startParts.d)
  // end is inclusive of the whole day, so the instant boundary is the *next* day's midnight
  const endLocalMidnightNextDay = new Date(endParts.y, endParts.m, endParts.d + 1)

  return {
    start: fromZonedTime(startLocalMidnight, timezone),
    end: fromZonedTime(endLocalMidnightNextDay, timezone),
    startLabel: toLabel(startParts.y, startParts.m, startParts.d),
    endLabel: toLabel(endParts.y, endParts.m, endParts.d),
  }
}

/** Same range, as `@db.Date`-comparable UTC-midnight labels (for `Expense.expenseDate`, a plain date column). */
export function resolveReportDateOnlyRange(params: DateRangeParams, timezone: string): { start: Date; end: Date } {
  const { startLabel, endLabel } = resolveReportInstantRange(params, timezone)
  const [sy, sm, sd] = startLabel.split("-").map(Number)
  const [ey, em, ed] = endLabel.split("-").map(Number)
  return { start: new Date(Date.UTC(sy, sm - 1, sd)), end: new Date(Date.UTC(ey, em - 1, ed)) }
}

/**
 * Every "YYYY-MM-DD" from `startLabel` to `endLabel` inclusive, in order —
 * for zero-filling a per-day series so a chart shows the quiet days too.
 * Walks UTC midnights, which have no DST to trip over. Empty when either
 * label is malformed or the range is inverted.
 */
export function eachDayLabel(startLabel: string, endLabel: string): string[] {
  const start = parseDateOnly(startLabel)
  const end = parseDateOnly(endLabel)
  if (!start || !end) return []
  const labels: string[] = []
  const endMs = Date.UTC(end.y, end.m, end.d)
  for (let t = Date.UTC(start.y, start.m, start.d); t <= endMs; t += 86_400_000) {
    const day = new Date(t)
    labels.push(toLabel(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()))
  }
  return labels
}
