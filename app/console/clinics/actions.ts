"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { ForbiddenError } from "@/lib/permissions/errors"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { createClinicSchema, editClinicSchema } from "@/lib/validation/clinic"
import {
  createClinic,
  updateClinic,
  setClinicActive,
  type CreateClinicResult,
  type ManageClinicResult,
} from "@/lib/queries/clinics"

/**
 * Holding admin only — unlike user management, a clinic admin has no
 * access here at all. proxy.ts's /console gate lets both admin roles
 * through, so this is the first place the distinction is made (the page
 * components gate themselves the same way, and lib/queries/clinics.ts
 * re-checks independently).
 */
async function actingUser(): Promise<AbilitySubject> {
  const session = await auth()
  if (!session?.user) throw new ForbiddenError("Not signed in")
  if (session.user.role !== "HOLDING_ADMIN") {
    throw new ForbiddenError("Only a holding admin manages clinics")
  }
  return {
    id: session.user.id,
    role: session.user.role,
    clinicId: session.user.clinicId,
    holdingCompanyId: session.user.holdingCompanyId,
  }
}

export async function createClinicAction(formData: Record<string, unknown>): Promise<CreateClinicResult> {
  const user = await actingUser()
  const parsed = createClinicSchema.safeParse(formData)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form for errors." }
  }
  const result = await createClinic(user, parsed.data)
  if (result.ok) revalidatePath("/console/clinics")
  return result
}

export async function updateClinicAction(
  id: string,
  formData: Record<string, unknown>
): Promise<ManageClinicResult> {
  const user = await actingUser()
  const parsed = editClinicSchema.safeParse(formData)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form for errors." }
  }
  const result = await updateClinic(user, id, parsed.data)
  if (result.ok) revalidatePath("/console/clinics")
  return result
}

export async function setClinicActiveAction(id: string, isActive: boolean): Promise<ManageClinicResult> {
  const user = await actingUser()
  const result = await setClinicActive(user, id, isActive)
  if (result.ok) revalidatePath("/console/clinics")
  return result
}
