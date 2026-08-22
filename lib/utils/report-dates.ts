import { fromZonedTime, toZonedTime } from "date-fns-tz"

export type DateRangeParams = { start?: string; end?: string } // "YYYY-MM-DD"

function parseDateOnly(value: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  return { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) }
}

/**
 * Resolves a report's date-range query params into the real UTC instants
 * bounding that range *in the clinic's own timezone* — for filtering real
 * timestamp columns (`Payment.receivedAt`, `Consultation.createdAt`, …).
 * Defaults to the last 30 days (inclusive of today) when unset. See
 * `todayInstantRange` in lib/queries/queue.ts for why this can't just use
 * UTC-midnight labels directly, and for why `fromZonedTime`'s input below
 * is built with the plain `Date` constructor rather than `Date.UTC`.
 */
export function resolveReportInstantRange(params: DateRangeParams, timezone: string): { start: Date; end: Date; startLabel: string; endLabel: string } {
  // toZonedTime's result must be read with plain (non-UTC) getters — see
  // todayAsQueueDate in lib/queries/queue.ts for why.
  const now = toZonedTime(new Date(), timezone)
  const defaultEnd = { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() }
  const thirtyDaysAgo = new Date(Date.UTC(defaultEnd.y, defaultEnd.m, defaultEnd.d - 29))
  const defaultStart = { y: thirtyDaysAgo.getUTCFullYear(), m: thirtyDaysAgo.getUTCMonth(), d: thirtyDaysAgo.getUTCDate() }

  const startParts = (params.start && parseDateOnly(params.start)) || defaultStart
  const endParts = (params.end && parseDateOnly(params.end)) || defaultEnd

  const startLocalMidnight = new Date(startParts.y, startParts.m, startParts.d)
  // end is inclusive of the whole day, so the instant boundary is the *next* day's midnight
  const endLocalMidnightNextDay = new Date(endParts.y, endParts.m, endParts.d + 1)

  return {
    start: fromZonedTime(startLocalMidnight, timezone),
    end: fromZonedTime(endLocalMidnightNextDay, timezone),
    startLabel: `${startParts.y}-${String(startParts.m + 1).padStart(2, "0")}-${String(startParts.d).padStart(2, "0")}`,
    endLabel: `${endParts.y}-${String(endParts.m + 1).padStart(2, "0")}-${String(endParts.d).padStart(2, "0")}`,
  }
}

/** Same range, as `@db.Date`-comparable UTC-midnight labels (for `Expense.expenseDate`, a plain date column). */
export function resolveReportDateOnlyRange(params: DateRangeParams, timezone: string): { start: Date; end: Date } {
  const { startLabel, endLabel } = resolveReportInstantRange(params, timezone)
  const [sy, sm, sd] = startLabel.split("-").map(Number)
  const [ey, em, ed] = endLabel.split("-").map(Number)
  return { start: new Date(Date.UTC(sy, sm - 1, sd)), end: new Date(Date.UTC(ey, em - 1, ed)) }
}
