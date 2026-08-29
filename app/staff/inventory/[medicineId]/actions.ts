"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { ForbiddenError } from "@/lib/permissions/errors"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { updateMedicine } from "@/lib/queries/inventory"

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

export async function updateMedicineAction(
  medicineId: string,
  input: Record<string, unknown>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await actingUser()
  try {
    await updateMedicine(user, medicineId, input)
    revalidatePath(`/staff/inventory/${medicineId}`)
    revalidatePath("/staff/inventory")
    return { ok: true }
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message }
    if (err && typeof err === "object" && "issues" in err) {
      const zodErr = err as { issues: { message: string }[] }
      return { ok: false, error: zodErr.issues[0]?.message ?? "Check the form for errors." }
    }
    return { ok: false, error: "Something went wrong. Please try again." }
  }
}
