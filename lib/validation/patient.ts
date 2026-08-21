import { z } from "zod"
import { ageInYears } from "@/lib/utils/age"

/**
 * Base fields shared by every patient-intake screen: walk-in registration
 * (M2, §7.2), public online booking (M3, §7.1), and later phone-in
 * registration. Guardian name/phone are conditionally required when the
 * computed age is under 18 (§6: "Support minors") — each schema built from
 * this base adds that check itself via `.superRefine`, since a bare
 * `ZodObject` can't carry the refinement and still be `.extend()`-able.
 */
const patientBaseFields = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  middleName: z.string().trim().optional(),
  birthdate: z.coerce.date({ error: "Enter a valid birthdate" }),
  sex: z.enum(["MALE", "FEMALE"]),
  phone: z.string().trim().min(7, "Enter a valid mobile number"),
  email: z.union([z.literal(""), z.string().trim().email()]).optional(),
  address: z.string().trim().min(1, "Address is required"),
  emergencyContactName: z.string().trim().min(1, "Emergency contact name is required"),
  emergencyContactPhone: z.string().trim().min(7, "Enter a valid emergency contact number"),
  guardianName: z.string().trim().optional(),
  guardianPhone: z.string().trim().optional(),
  reasonForVisit: z.string().trim().min(1, "Reason for visit is required"),
  priority: z.boolean(),
  consent: z.literal(true, { error: "Consent to collect and use health information is required" }),
})

function requireGuardianIfMinor(v: { birthdate: Date; guardianName?: string; guardianPhone?: string }, ctx: z.RefinementCtx) {
  if (ageInYears(v.birthdate) < 18) {
    if (!v.guardianName?.trim()) {
      ctx.addIssue({ code: "custom", message: "Guardian name is required for a minor", path: ["guardianName"] })
    }
    if (!v.guardianPhone?.trim()) {
      ctx.addIssue({ code: "custom", message: "Guardian phone is required for a minor", path: ["guardianPhone"] })
    }
  }
}

/** §7.2 walk-in registration — reasonForVisit/priority collected up front, no preferred date (they're already here). */
export const patientIntakeSchema = patientBaseFields
  .refine((v) => v.birthdate.getTime() <= Date.now(), {
    message: "Birthdate can't be in the future",
    path: ["birthdate"],
  })
  .superRefine(requireGuardianIfMinor)

export type PatientIntakeInput = z.infer<typeof patientIntakeSchema>

/**
 * §7.1 public online booking — same fields plus a preferred date, which
 * the DECISION at §7.1 restricts to same-day or next-day only (a full
 * appointment-time-slot system is explicitly out of scope).
 */
export const bookingIntakeSchema = patientBaseFields
  .extend({ preferredDate: z.enum(["today", "tomorrow"]) })
  .refine((v) => v.birthdate.getTime() <= Date.now(), {
    message: "Birthdate can't be in the future",
    path: ["birthdate"],
  })
  .superRefine(requireGuardianIfMinor)

export type BookingIntakeInput = z.infer<typeof bookingIntakeSchema>
