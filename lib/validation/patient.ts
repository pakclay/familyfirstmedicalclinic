import { z } from "zod"
import { ageInYears } from "@/lib/utils/age"

/**
 * Shared by walk-in registration (M2, §7.2) now and public online booking
 * (M3, §7.1) later — both forms collect the same patient fields. Guardian
 * name/phone are conditionally required when the computed age is under 18
 * (§6: "Support minors"), checked here so it's enforced no matter which
 * screen submits it, not just in whichever form happens to render the
 * conditional fields.
 */
export const patientIntakeSchema = z
  .object({
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
  .refine((v) => v.birthdate.getTime() <= Date.now(), {
    message: "Birthdate can't be in the future",
    path: ["birthdate"],
  })
  .superRefine((v, ctx) => {
    if (ageInYears(v.birthdate) < 18) {
      if (!v.guardianName?.trim()) {
        ctx.addIssue({ code: "custom", message: "Guardian name is required for a minor", path: ["guardianName"] })
      }
      if (!v.guardianPhone?.trim()) {
        ctx.addIssue({ code: "custom", message: "Guardian phone is required for a minor", path: ["guardianPhone"] })
      }
    }
  })

export type PatientIntakeInput = z.infer<typeof patientIntakeSchema>
