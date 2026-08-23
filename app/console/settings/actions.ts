"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { ForbiddenError } from "@/lib/permissions/errors"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { clinicSettingsSchema } from "@/lib/validation/clinic"
import { updateOwnClinicSettings, type ManageClinicResult } from "@/lib/queries/clinics"

/**
 * Clinic admin only — the mirror image of app/console/clinics/actions.ts,
 * which is holding-admin only. A holding admin has no "own clinic" to
 * configure (their clinicId is null), so they're refused here rather than
 * silently falling through to a null-clinic lookup.
 */
async function actingUser(): Promise<AbilitySubject> {
  const session = await auth()
  if (!session?.user) throw new ForbiddenError("Not signed in")
  if (session.user.role !== "CLINIC_ADMIN") {
    throw new ForbiddenError("Only a clinic admin manages clinic settings")
  }
  return {
    id: session.user.id,
    role: session.user.role,
    clinicId: session.user.clinicId,
    holdingCompanyId: session.user.holdingCompanyId,
  }
}

/** No clinic id parameter, deliberately — see lib/queries/clinics.ts's own-clinic section. */
export async function updateClinicSettingsAction(formData: Record<string, unknown>): Promise<ManageClinicResult> {
  const user = await actingUser()
  const parsed = clinicSettingsSchema.safeParse(formData)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form for errors." }
  }
  const result = await updateOwnClinicSettings(user, parsed.data)
  if (result.ok) revalidatePath("/console/settings")
  return result
}
