import type { DateFormat } from "./target-fields"

/** Lenient PH mobile normalization for messy spreadsheet input — strips
 * spaces/dashes/parens, accepts +63/63/0 prefixes, returns 09XXXXXXXXX or
 * null if it can't be made to fit. */
export function normalizeMobileLenient(raw: string): string | null {
  const digits = raw.replace(/[\s\-().]/g, "")
  let d = digits
  if (d.startsWith("+63")) d = "0" + d.slice(3)
  else if (d.startsWith("63") && d.length === 12) d = "0" + d.slice(2)
  else if (d.startsWith("9") && d.length === 10) d = "0" + d

  if (/^09\d{9}$/.test(d)) return d
  return null
}

export function normalizeSex(raw: string): "MALE" | "FEMALE" | null {
  const v = raw.trim().toUpperCase()
  if (["M", "MALE"].includes(v)) return "MALE"
  if (["F", "FEMALE"].includes(v)) return "FEMALE"
  return null
}

/** Tolerant of `/`, `-`, `.` separators; interprets ambiguous numeric dates
 * per the operator-chosen format (§12: "ask which, don't guess"). */
export function parseDateLenient(raw: string, format: DateFormat): Date | null {
  const trimmed = raw.trim()

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoMatch) {
    const [, y, m, d] = isoMatch
    return toValidDate(Number(y), Number(m), Number(d))
  }

  const match = trimmed.match(/^(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{1,4})$/)
  if (!match) return null
  const [, a, b, c] = match.map(Number) as unknown as [string, number, number, number]

  // Four-digit first part only happens as YYYY in practice.
  if (String(a).length === 4) return toValidDate(a, b, c)

  const [month, day] = format === "MDY" ? [a, b] : [b, a]
  return toValidDate(c, month, day)
}

function toValidDate(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null
  }
  return date
}
