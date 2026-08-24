"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { ForbiddenError } from "@/lib/permissions/errors"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { deleteDispensedMedicine } from "@/lib/queries/inventory"

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

export async function deleteDispensedMedicineAction(
  patientId: string,
  medicineDispensedId: string,
  reason: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await actingUser()
  try {
    await deleteDispensedMedicine(user, medicineDispensedId, reason)
    revalidatePath(`/staff/patients/${patientId}`)
    return { ok: true }
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message }
    if (err instanceof Error) return { ok: false, error: err.message }
    return { ok: false, error: "Something went wrong. Please try again." }
  }
}
