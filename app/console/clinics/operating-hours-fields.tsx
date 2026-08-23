"use client"

import { Input } from "@/components/ui/input"
import { WEEKDAYS, WEEKDAY_LABEL, type OperatingHours, type Weekday } from "@/lib/validation/clinic"

/**
 * A closed day stores no times, but the inputs still need something to show
 * if the admin unchecks "Closed" — so the times live here alongside the flag
 * rather than being derived from the saved value, and unchecking restores
 * what was last typed instead of leaving a blank row.
 */
export type DayForm = { open: string; close: string; closed: boolean }

const FALLBACK_OPEN = "09:00"
const FALLBACK_CLOSE = "18:00"

/** Mon–Sat open, Sunday closed — the shape the existing clinics were seeded with. */
export function defaultDayForms(): Record<Weekday, DayForm> {
  return {
    mon: { open: FALLBACK_OPEN, close: FALLBACK_CLOSE, closed: false },
    tue: { open: FALLBACK_OPEN, close: FALLBACK_CLOSE, closed: false },
    wed: { open: FALLBACK_OPEN, close: FALLBACK_CLOSE, closed: false },
    thu: { open: FALLBACK_OPEN, close: FALLBACK_CLOSE, closed: false },
    fri: { open: FALLBACK_OPEN, close: FALLBACK_CLOSE, closed: false },
    sat: { open: "08:00", close: "12:00", closed: false },
    sun: { open: FALLBACK_OPEN, close: FALLBACK_CLOSE, closed: true },
  }
}

/** Hydrates the editor from a saved clinic; a null day becomes "closed" with fallback times ready. */
export function toDayForms(hours: OperatingHours): Record<Weekday, DayForm> {
  const forms = {} as Record<Weekday, DayForm>
  for (const day of WEEKDAYS) {
    const stored = hours[day]
    forms[day] = stored
      ? { open: stored.open, close: stored.close, closed: false }
      : { open: FALLBACK_OPEN, close: FALLBACK_CLOSE, closed: true }
  }
  return forms
}

/** The inverse — what the server actually stores, with closed days as null. */
export function toOperatingHours(forms: Record<Weekday, DayForm>): OperatingHours {
  return Object.fromEntries(
    WEEKDAYS.map((d) => [d, forms[d].closed ? null : { open: forms[d].open, close: forms[d].close }])
  ) as OperatingHours
}

export function OperatingHoursFields({
  value,
  onChange,
}: {
  value: Record<Weekday, DayForm>
  onChange: (next: Record<Weekday, DayForm>) => void
}) {
  function setDay(day: Weekday, patch: Partial<DayForm>) {
    onChange({ ...value, [day]: { ...value[day], ...patch } })
  }

  return (
    <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-medium">Operating hours</legend>
      {WEEKDAYS.map((day) => (
        <div key={day} className="flex flex-wrap items-center gap-2">
          <span className="w-24 text-sm">{WEEKDAY_LABEL[day]}</span>
          <Input
            aria-label={`${WEEKDAY_LABEL[day]} opening time`}
            type="time"
            className="h-9 w-32"
            disabled={value[day].closed}
            value={value[day].closed ? "" : value[day].open}
            onChange={(e) => setDay(day, { open: e.target.value })}
          />
          <span className="text-sm text-muted-foreground">to</span>
          <Input
            aria-label={`${WEEKDAY_LABEL[day]} closing time`}
            type="time"
            className="h-9 w-32"
            disabled={value[day].closed}
            value={value[day].closed ? "" : value[day].close}
            onChange={(e) => setDay(day, { close: e.target.value })}
          />
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <input type="checkbox" checked={value[day].closed} onChange={(e) => setDay(day, { closed: e.target.checked })} />
            Closed
          </label>
        </div>
      ))}
    </fieldset>
  )
}
