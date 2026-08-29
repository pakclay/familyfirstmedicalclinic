import { z } from "zod"
import { vitalsSchema as sharedVitalsSchema } from "./vitals"

// Shared with the front-desk capture form (lib/validation/vitals.ts) so a
// reading cannot be accepted at triage and rejected in the consultation
// room, or the reverse. Optional here because a consultation can be saved
// without re-recording vitals the doctor did not retake.
const vitalsSchema = sharedVitalsSchema.optional()

/**
 * One medicine row. §7.4: a row is either "dispensed from clinic stock"
 * (must reference a real catalog medicine — stock gets deducted) or
 * "prescribed only" (advised, not dispensed here — never touches stock,
 * even if the doctor picked a real catalog item to prefill the name/
 * strength). Free text not matching the catalog has no `medicineId` at
 * all, which on its own forces `dispensedFromStock` to false — there's no
 * stock to deduct from for a medicine that isn't in the catalog.
 */
const medicineRowSchema = z
  .object({
    medicineId: z.string().uuid().nullable(),
    medicineName: z.string().trim().min(1, "Medicine name is required"),
    dosage: z.string().trim().optional(),
    quantity: z.coerce.number().int().positive("Quantity must be at least 1"),
    instructions: z.string().trim().optional(),
    dispensedFromStock: z.boolean(),
  })
  .refine((v) => v.medicineId || !v.dispensedFromStock, {
    message: "Only a catalog medicine can be dispensed from stock — switch to \"prescribed only\" for free text",
    path: ["dispensedFromStock"],
  })

export const consultationSchema = z.object({
  chiefComplaint: z.string().trim().min(1, "Chief complaint is required"),
  vitals: vitalsSchema,
  findings: z.string().trim().optional(),
  diagnosis: z.string().trim().optional(),
  treatmentPlan: z.string().trim().optional(),
  followUpDate: z.union([z.literal(""), z.coerce.date()]).optional(),
  medicines: z.array(medicineRowSchema).default([]),
  // §7.5 DECISION: "dispense anyway (stock count is wrong)" — bypasses the
  // insufficient-stock block for every row in this save, not per-row; see
  // lib/queries/consultations.ts for what it actually does to the ledger.
  overrideInsufficientStock: z.boolean().default(false),
  payment: z.object({
    amount: z.coerce.number().int().min(0, "Amount can't be negative"),
    method: z.enum(["CASH", "GCASH", "CARD", "HMO", "OTHER"]),
    orNumber: z.string().trim().optional(),
    notes: z.string().trim().optional(),
  }),
})

export type ConsultationInput = z.infer<typeof consultationSchema>
