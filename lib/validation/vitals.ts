import { z } from "zod"

/**
 * Triage vitals. Shared by the front-desk capture form and the doctor's
 * consultation form so a reading cannot be valid in one place and rejected
 * in the other.
 *
 * Stored as strings rather than numbers, which is what `vitals` already
 * held on consultations — changing the JSON's value types would silently
 * invalidate every reading recorded before today. Blood pressure also has
 * no numeric representation ("120/80"), so the column was never uniformly
 * numeric to begin with.
 *
 * Every field stays optional: vitals are taken in whatever order the
 * equipment is free, and a half-filled set recorded now is more useful than
 * a complete one recorded never. But a field that IS filled in gets
 * checked, because the previous schema accepted any string at all — a
 * temperature of "999" or a typo'd weight of "700" was stored verbatim and
 * shown to the doctor as fact.
 */

/** Ranges bound what a living patient can plausibly measure, not what is healthy — a reading can be alarming and still be real. */
const RANGES = {
  temp: { min: 25, max: 45, unit: "°C", label: "Temperature" },
  weight: { min: 0.4, max: 400, unit: "kg", label: "Weight" },
  height: { min: 20, max: 260, unit: "cm", label: "Height" },
  pulse: { min: 20, max: 300, unit: "bpm", label: "Pulse" },
} as const

function numericField(key: keyof typeof RANGES) {
  const { min, max, unit, label } = RANGES[key]
  return z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || !Number.isNaN(Number(v)), {
      message: `${label} must be a number (${unit})`,
    })
    .refine((v) => !v || (Number(v) >= min && Number(v) <= max), {
      message: `${label} must be between ${min} and ${max} ${unit}`,
    })
}

/**
 * Blood pressure is the one free-form field. Accepts "120/80" and a bare
 * systolic, since a manual cuff reading is sometimes recorded as one
 * number, but rejects prose so the field cannot quietly become a notes box.
 */
const bpField = z
  .string()
  .trim()
  .optional()
  .refine((v) => !v || /^\d{2,3}(\s*\/\s*\d{2,3})?$/.test(v), {
    message: "Blood pressure looks like 120/80",
  })

export const vitalsSchema = z.object({
  bp: bpField,
  temp: numericField("temp"),
  weight: numericField("weight"),
  height: numericField("height"),
  pulse: numericField("pulse"),
})

export type VitalsInput = z.infer<typeof vitalsSchema>

/** The shape stored in the `vitals` JSON column. Empty strings are dropped rather than persisted as noise. */
export function toStoredVitals(input: VitalsInput): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" && value.trim()) out[key] = value.trim()
  }
  return out
}

/** True when nothing was actually filled in — used to reject a save that would record an empty reading. */
export function isEmptyVitals(input: VitalsInput): boolean {
  return Object.keys(toStoredVitals(input)).length === 0
}
