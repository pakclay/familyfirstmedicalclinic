import { z } from "zod"

// §12: PH mobile format tolerant of 09XXXXXXXXX and +639XXXXXXXXX.
export const phMobileSchema = z
  .string()
  .trim()
  .refine((v) => /^(09\d{9}|\+639\d{9})$/.test(v), {
    message: "Enter a PH mobile number as 09XXXXXXXXX or +639XXXXXXXXX",
  })

export function normalizePhMobile(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith("+63")) return "0" + trimmed.slice(3)
  return trimmed
}

export const consentTypeSchema = z.enum(["TREATMENT", "DATA_PRIVACY", "MARKETING", "PHOTO"])

export const intakeAnswersSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  middleName: z.string().trim().optional(),
  birthDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Enter a valid date"),
  sex: z.enum(["MALE", "FEMALE"]),
  mobile: phMobileSchema,
  email: z.string().email().optional().or(z.literal("")),
  address: z.string().trim().min(1, "Address is required"),
  city: z.string().trim().min(1, "City is required"),
  province: z.string().trim().min(1, "Province is required"),
  occupation: z.string().trim().optional(),
  sportOrActivity: z.string().trim().optional(),
  referralSource: z.string().trim().optional(),
  emergencyContactName: z.string().trim().min(1, "Emergency contact name is required"),
  emergencyContactPhone: phMobileSchema,
  preferredChannel: z.enum(["SMS", "EMAIL", "MESSENGER", "VIBER"]).optional(),
  chiefComplaint: z.string().trim().optional(),
  // §11: consents captured individually, not as a single blanket checkbox.
  consentTreatment: z.boolean(),
  consentDataPrivacy: z.boolean(),
  consentMarketing: z.boolean(),
  consentPhoto: z.boolean(),
  // §11: patients under 18 require a guardian name.
  guardianName: z.string().trim().optional(),
})

export type IntakeAnswers = z.infer<typeof intakeAnswersSchema>

export const isMinor = (birthDate: string) => {
  const dob = new Date(birthDate)
  const age = (Date.now() - dob.getTime()) / (1000 * 60 * 60 * 24 * 365.25)
  return age < 18
}
