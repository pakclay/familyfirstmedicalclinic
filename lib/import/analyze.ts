import { TARGET_FIELDS, type ColumnMapping, type DateFormat, type ImportRow, type TargetField } from "./target-fields"
import { normalizeMobileLenient, normalizeSex, parseDateLenient } from "./normalize"

export type ParsedRowData = {
  firstName: string
  lastName: string
  middleName?: string
  birthDate: string // ISO yyyy-mm-dd
  sex: "MALE" | "FEMALE"
  mobile: string
  email?: string
  address: string
  city: string
  province: string
  occupation?: string
  sportOrActivity?: string
  referralSource?: string
  emergencyContactName?: string
  emergencyContactPhone?: string
}

export type RowAnalysis =
  | { rowNumber: number; ok: true; data: ParsedRowData }
  | { rowNumber: number; ok: false; errors: string[] }

function get(row: ImportRow, mapping: ColumnMapping, field: TargetField): string {
  const header = mapping[field]
  if (!header) return ""
  return (row[header] ?? "").toString().trim()
}

/** Pure, DB-free per-row validation — the part covered by unit tests.
 * Dedupe (which needs a DB lookup) happens one layer up in the server action. */
export function analyzeRow(row: ImportRow, mapping: ColumnMapping, dateFormat: DateFormat, rowNumber: number): RowAnalysis {
  const errors: string[] = []

  for (const { field, label, required } of TARGET_FIELDS) {
    if (required && !get(row, mapping, field)) {
      errors.push(`${label} is required`)
    }
  }

  const mobileRaw = get(row, mapping, "mobile")
  const mobile = mobileRaw ? normalizeMobileLenient(mobileRaw) : null
  if (mobileRaw && !mobile) errors.push(`Mobile "${mobileRaw}" is not a valid PH number`)

  const sexRaw = get(row, mapping, "sex")
  const sex = sexRaw ? normalizeSex(sexRaw) : null
  if (sexRaw && !sex) errors.push(`Sex "${sexRaw}" is not M/F`)

  const birthDateRaw = get(row, mapping, "birthDate")
  const birthDate = birthDateRaw ? parseDateLenient(birthDateRaw, dateFormat) : null
  if (birthDateRaw && !birthDate) errors.push(`Birth date "${birthDateRaw}" could not be parsed`)

  const emergencyPhoneRaw = get(row, mapping, "emergencyContactPhone")
  const emergencyPhone = emergencyPhoneRaw ? normalizeMobileLenient(emergencyPhoneRaw) : null
  if (emergencyPhoneRaw && !emergencyPhone) {
    errors.push(`Emergency contact phone "${emergencyPhoneRaw}" is not a valid PH number`)
  }

  if (errors.length > 0) return { rowNumber, ok: false, errors }

  return {
    rowNumber,
    ok: true,
    data: {
      firstName: get(row, mapping, "firstName"),
      lastName: get(row, mapping, "lastName"),
      middleName: get(row, mapping, "middleName") || undefined,
      birthDate: birthDate!.toISOString().slice(0, 10),
      sex: sex!,
      mobile: mobile!,
      email: get(row, mapping, "email") || undefined,
      address: get(row, mapping, "address"),
      city: get(row, mapping, "city"),
      province: get(row, mapping, "province"),
      occupation: get(row, mapping, "occupation") || undefined,
      sportOrActivity: get(row, mapping, "sportOrActivity") || undefined,
      referralSource: get(row, mapping, "referralSource") || undefined,
      emergencyContactName: get(row, mapping, "emergencyContactName") || undefined,
      emergencyContactPhone: emergencyPhone || undefined,
    },
  }
}
