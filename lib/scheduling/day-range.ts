import { fromZonedTime, toZonedTime } from "date-fns-tz"
import { APP_TIMEZONE } from "./availability"

/** UTC [start, end) instants for one Manila civil day, given its "yyyy-MM-dd" key. */
export function manilaDayRange(dateKey: string): { dayStart: Date; dayEnd: Date } {
  const dayStart = fromZonedTime(`${dateKey}T00:00:00`, APP_TIMEZONE)
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
  return { dayStart, dayEnd }
}

/** "yyyy-MM-dd" for the Manila civil date a UTC instant falls on — safe
 * regardless of the runtime's own system timezone (see availability.ts). */
export function formatManilaKey(date: Date): string {
  const zoned = toZonedTime(date, APP_TIMEZONE)
  return `${zoned.getUTCFullYear()}-${String(zoned.getUTCMonth() + 1).padStart(2, "0")}-${String(zoned.getUTCDate()).padStart(2, "0")}`
}

export function todayManilaKey(): string {
  return formatManilaKey(new Date())
}

export function addDaysToKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + days))
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`
}
