import { z } from "zod"

/**
 * The seven keys of the `branches.operating_hours` JSON column, in display
 * order. Exported so the DTO normalizer and both branch forms iterate the
 * same list rather than each hard-coding their own — a mismatch there
 * would silently drop a day's hours on save. Shared between
 * lib/validation/branch.ts and lib/dto/branch.ts rather than owned by
 * either, since hours are a concept both files need but neither defines.
 */
export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const
export type Weekday = (typeof WEEKDAYS)[number]

export const WEEKDAY_LABEL: Record<Weekday, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
}

/** 24-hour "HH:MM" — what <input type="time"> produces natively. */
export const TIME_24H = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * One weekday's hours, or null when the branch is closed that day.
 * Zero-padded "HH:MM" compares correctly as a plain string, so the
 * open-before-close check needs no time parsing at all.
 */
export const dayHoursSchema = z
  .object({
    open: z.string().trim().regex(TIME_24H, "Enter opening time as HH:MM"),
    close: z.string().trim().regex(TIME_24H, "Enter closing time as HH:MM"),
  })
  .nullable()
  .refine((v) => v === null || v.open < v.close, {
    message: "A day's closing time must be after its opening time",
  })

export const operatingHoursSchema = z.object({
  mon: dayHoursSchema,
  tue: dayHoursSchema,
  wed: dayHoursSchema,
  thu: dayHoursSchema,
  fri: dayHoursSchema,
  sat: dayHoursSchema,
  sun: dayHoursSchema,
})

export type DayHours = { open: string; close: string }
export type OperatingHours = z.infer<typeof operatingHoursSchema>
