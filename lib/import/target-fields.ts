export type TargetField =
  | "firstName"
  | "lastName"
  | "middleName"
  | "birthDate"
  | "sex"
  | "mobile"
  | "email"
  | "address"
  | "city"
  | "province"
  | "occupation"
  | "sportOrActivity"
  | "referralSource"
  | "emergencyContactName"
  | "emergencyContactPhone"

export const TARGET_FIELDS: { field: TargetField; label: string; required: boolean }[] = [
  { field: "firstName", label: "First name", required: true },
  { field: "lastName", label: "Last name", required: true },
  { field: "middleName", label: "Middle name", required: false },
  { field: "birthDate", label: "Birth date", required: true },
  { field: "sex", label: "Sex (M/F)", required: true },
  { field: "mobile", label: "Mobile number", required: true },
  { field: "email", label: "Email", required: false },
  { field: "address", label: "Address", required: true },
  { field: "city", label: "City", required: true },
  { field: "province", label: "Province", required: true },
  { field: "occupation", label: "Occupation", required: false },
  { field: "sportOrActivity", label: "Sport / activity", required: false },
  { field: "referralSource", label: "Referral source", required: false },
  { field: "emergencyContactName", label: "Emergency contact name", required: false },
  { field: "emergencyContactPhone", label: "Emergency contact phone", required: false },
]

export type ColumnMapping = Partial<Record<TargetField, string>>

export type DateFormat = "MDY" | "DMY"

export type ImportRow = Record<string, string>
