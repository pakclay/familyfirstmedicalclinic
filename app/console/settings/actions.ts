"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { ForbiddenError } from "@/lib/permissions/errors"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { branchSettingsSchema } from "@/lib/validation/branch"
import { updateOwnBranchSettings, type ManageBranchResult } from "@/lib/queries/branches"

/**
 * Clinic admin only — the mirror image of app/console/clinics/actions.ts,
 * which is holding-admin only. A holding admin has no "own branch" to
 * configure (their branchId is null), so they're refused here rather than
 * silently falling through to a null-branch lookup.
 */
async function actingUser(): Promise<AbilitySubject> {
  const session = await auth()
  if (!session?.user) throw new ForbiddenError("Not signed in")
  if (session.user.role !== "CLINIC_ADMIN") {
    throw new ForbiddenError("Only a clinic admin manages branch settings")
  }
  return {
    id: session.user.id,
    role: session.user.role,
    branchId: session.user.branchId,
    holdingCompanyId: session.user.holdingCompanyId,
  }
}

/** No branch id parameter, deliberately — see lib/queries/branches.ts's own-branch section. */
export async function updateBranchSettingsAction(formData: Record<string, unknown>): Promise<ManageBranchResult> {
  const user = await actingUser()
  const parsed = branchSettingsSchema.safeParse(formData)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form for errors." }
  }
  const result = await updateOwnBranchSettings(user, parsed.data)
  if (result.ok) revalidatePath("/console/settings")
  return result
}
