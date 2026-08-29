"use server"

import { auth } from "@/auth"
import { ForbiddenError } from "@/lib/permissions/errors"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { createMedicine } from "@/lib/queries/inventory"

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

export async function createMedicineAction(
  input: Record<string, unknown>
): Promise<{ ok: true; medicineId: string } | { ok: false; error: string }> {
  const user = await actingUser()
  try {
    const medicine = await createMedicine(user, input)
    return { ok: true, medicineId: medicine.id }
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message }
    if (err && typeof err === "object" && "issues" in err) {
      const zodErr = err as { issues: { message: string }[] }
      return { ok: false, error: zodErr.issues[0]?.message ?? "Check the form for errors." }
    }
    return { ok: false, error: "Something went wrong. Please try again." }
  }
}
