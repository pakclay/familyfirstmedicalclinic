"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { ForbiddenError } from "@/lib/permissions/errors"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { editBrandingSchema } from "@/lib/validation/branding"
import { updateBranding, type UpdateBrandingResult } from "@/lib/queries/branding"

/**
 * Same gate as app/console/clinics/actions.ts: proxy.ts's /console check
 * lets both admin roles through, so the holding-admin distinction is made
 * here first, and again in lib/queries/branding.ts.
 */
async function actingUser(): Promise<AbilitySubject> {
  const session = await auth()
  if (!session?.user) throw new ForbiddenError("Not signed in")
  if (session.user.role !== "HOLDING_ADMIN") {
    throw new ForbiddenError("Only a holding admin changes the app name")
  }
  return {
    id: session.user.id,
    role: session.user.role,
    branchId: session.user.branchId,
    holdingCompanyId: session.user.holdingCompanyId,
  }
}

export async function updateBrandingAction(
  formData: Record<string, unknown>
): Promise<UpdateBrandingResult> {
  const user = await actingUser()
  const parsed = editBrandingSchema.safeParse(formData)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form for errors." }
  }
  const result = await updateBranding(user, parsed.data)
  // The whole tree, not just this page: the name is read by the root
  // layout's title and by the header on every authenticated shell, so a
  // rename that only refreshed /console/admin would leave the old name in
  // the tab and the header until something else happened to invalidate them.
  if (result.ok) revalidatePath("/", "layout")
  return result
}
