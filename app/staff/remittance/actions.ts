"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { ForbiddenError } from "@/lib/permissions/errors"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { submitRemittance, confirmRemittance } from "@/lib/queries/remittance"

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

export async function submitRemittanceAction(actualAmountPesos: number, notes: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await actingUser()
  try {
    await submitRemittance(user, Math.round(actualAmountPesos * 100), notes)
    revalidatePath("/staff/remittance")
    return { ok: true }
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message }
    return { ok: false, error: "Something went wrong. Please try again." }
  }
}

export async function confirmRemittanceAction(remittanceId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await actingUser()
  try {
    await confirmRemittance(user, remittanceId)
    revalidatePath("/staff/remittance")
    return { ok: true }
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message }
    return { ok: false, error: "Something went wrong. Please try again." }
  }
}
