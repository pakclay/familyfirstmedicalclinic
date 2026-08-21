import { z } from "zod"

export const assessmentSchema = z.object({
  track: z.enum(["WELLNESS", "REHAB"]),
  chiefComplaint: z.string().trim().min(1, "Chief complaint is required"),
  painScale: z.coerce.number().int().min(0).max(10),
  painLocation: z.string().trim().optional(),
  onsetDate: z.string().optional(),
  mechanismOfInjury: z.string().trim().optional(),
  romFindings: z.string().trim().optional(),
  specialTests: z.string().trim().optional(),
  // Comma-separated in the form, split into an array before saving.
  redFlags: z.string().trim().optional(),
  recommendation: z.string().trim().min(1, "Recommendation is required"),
  // Not user-settable — §6 is unconditional ("wellness clients never touch
  // the doctor queue"), so this is always derived from `track` server-side
  // (createAssessmentFor), never taken from client input.
})

export type AssessmentInput = z.infer<typeof assessmentSchema>

export const prescriptionSchema = z.object({
  diagnosis: z.string().trim().min(1, "Diagnosis is required"),
  icd10: z.string().trim().optional(),
  prescribedSessions: z.coerce.number().int().min(1).max(100),
  frequencyPerWeek: z.coerce.number().int().min(1).max(14),
  // Comma-separated in the form.
  modalities: z.string().trim().optional(),
  precautions: z.string().trim().optional(),
  goals: z.string().trim().optional(),
  validFrom: z.string().min(1, "Valid-from date is required"),
  validUntil: z.string().min(1, "Valid-until date is required"),
})

export type PrescriptionInput = z.infer<typeof prescriptionSchema>

export const carePlanSchema = z.object({
  totalSessions: z.coerce.number().int().min(1).max(200),
  targetEndDate: z.string().optional(),
  assignedTherapistId: z.string().min(1, "Assign a therapist"),
})

export type CarePlanInput = z.infer<typeof carePlanSchema>

export const sessionNoteSchema = z.object({
  subjective: z.string().trim().min(1, "Required"),
  objective: z.string().trim().min(1, "Required"),
  assessment: z.string().trim().min(1, "Required"),
  plan: z.string().trim().min(1, "Required"),
  painBefore: z.coerce.number().int().min(0).max(10).optional(),
  painAfter: z.coerce.number().int().min(0).max(10).optional(),
  modalitiesPerformed: z.string().trim().optional(),
})

export type SessionNoteInput = z.infer<typeof sessionNoteSchema>
