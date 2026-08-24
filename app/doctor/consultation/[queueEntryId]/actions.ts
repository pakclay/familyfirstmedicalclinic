"use server"

import { auth } from "@/auth"
import { ForbiddenError } from "@/lib/permissions/errors"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { saveConsultation, InsufficientStockError } from "@/lib/queries/consultations"

async function actingUser(): Promise<AbilitySubject> {
  const session = await auth()
  if (!session?.user) throw new ForbiddenError("Not signed in")
  return {
    id: session.user.id,
    role: session.user.role,
    branchId: session.user.branchId,
    holdingCompanyId: session.user.holdingCompanyId,
  }
}

export type SaveConsultationResult =
  | { ok: true; consultationId: string }
  | { ok: false; error: string; insufficientStock?: boolean }

export async function saveConsultationAction(
  queueEntryId: string,
  input: Record<string, unknown>
): Promise<SaveConsultationResult> {
  const user = await actingUser()
  try {
    const result = await saveConsultation(user, queueEntryId, input)
    return { ok: true, consultationId: result.consultationId }
  } catch (err) {
    if (err instanceof InsufficientStockError) {
      return { ok: false, error: err.message, insufficientStock: true }
    }
    if (err && typeof err === "object" && "issues" in err) {
      const zodErr = err as { issues: { message: string }[] }
      return { ok: false, error: zodErr.issues[0]?.message ?? "Check the form for errors." }
    }
    if (err instanceof Error) {
      return { ok: false, error: err.message }
    }
    return { ok: false, error: "Something went wrong. Please try again." }
  }
}
