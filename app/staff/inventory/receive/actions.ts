"use server"

import { auth } from "@/auth"
import { ForbiddenError } from "@/lib/permissions/errors"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { receiveStock } from "@/lib/queries/inventory"
import { listMedicines } from "@/lib/queries/inventory"

async function actingUser(): Promise<AbilitySubject> {
  const session = await auth()
  if (!session?.user) throw new ForbiddenError("Not signed in")
  return {
    id: session.user.id,
    role: session.user.role,
    clinicId: session.user.clinicId,
    holdingCompanyId: session.user.holdingCompanyId,
  }
}

export async function searchMedicinesAction(query: string) {
  const user = await actingUser()
  return listMedicines(user, { search: query })
}

export async function receiveStockAction(
  input: Record<string, unknown>
): Promise<{ ok: true; medicineName: string; newStock: number } | { ok: false; error: string }> {
  const user = await actingUser()
  try {
    const medicine = await receiveStock(user, input)
    return { ok: true, medicineName: medicine.name, newStock: medicine.currentStock }
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message }
    if (err && typeof err === "object" && "issues" in err) {
      const zodErr = err as { issues: { message: string }[] }
      return { ok: false, error: zodErr.issues[0]?.message ?? "Check the form for errors." }
    }
    return { ok: false, error: "Something went wrong. Please try again." }
  }
}
