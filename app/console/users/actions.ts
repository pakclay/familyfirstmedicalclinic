"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { ForbiddenError } from "@/lib/permissions/errors"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { createUserSchema, editUserSchema } from "@/lib/validation/user"
import {
  createUser,
  updateUser,
  setUserActive,
  forcePasswordReset,
  unlockAccount,
  type CreateUserResult,
  type ManageUserResult,
} from "@/lib/queries/users"

async function actingUser(): Promise<AbilitySubject> {
  const session = await auth()
  if (!session?.user) throw new ForbiddenError("Not signed in")
  if (session.user.role !== "HOLDING_ADMIN" && session.user.role !== "CLINIC_ADMIN") {
    throw new ForbiddenError("Only an admin manages users")
  }
  return {
    id: session.user.id,
    role: session.user.role,
    branchId: session.user.branchId,
    holdingCompanyId: session.user.holdingCompanyId,
  }
}

export async function createUserAction(formData: Record<string, unknown>): Promise<CreateUserResult> {
  const user = await actingUser()
  const parsed = createUserSchema.safeParse(formData)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form for errors." }
  }
  const result = await createUser(user, parsed.data)
  if (result.ok) revalidatePath("/console/users")
  return result
}

export async function updateUserAction(id: string, formData: Record<string, unknown>): Promise<ManageUserResult> {
  const user = await actingUser()
  const parsed = editUserSchema.safeParse(formData)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form for errors." }
  }
  const result = await updateUser(user, id, parsed.data)
  if (result.ok) revalidatePath("/console/users")
  return result
}

export async function setUserActiveAction(id: string, isActive: boolean): Promise<ManageUserResult> {
  const user = await actingUser()
  const result = await setUserActive(user, id, isActive)
  if (result.ok) revalidatePath("/console/users")
  return result
}

export async function forcePasswordResetAction(id: string): Promise<ManageUserResult> {
  const user = await actingUser()
  const result = await forcePasswordReset(user, id)
  if (result.ok) revalidatePath("/console/users")
  return result
}

export async function unlockAccountAction(id: string): Promise<ManageUserResult> {
  const user = await actingUser()
  const result = await unlockAccount(user, id)
  if (result.ok) revalidatePath("/console/users")
  return result
}
