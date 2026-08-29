"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { ForbiddenError } from "@/lib/permissions/errors"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { createUserSchema, editUserSchema, changeRoleSchema } from "@/lib/validation/user"
import {
  createUser,
  updateUser,
  setUserActive,
  forcePasswordReset,
  changeUserRole,
  regenerateTempPassword,
  unlockAccount,
  type CreateUserResult,
  type ManageUserResult,
  type RegenerateTempPasswordResult,
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

/**
 * A user row is rendered in three places — the flat /console/users list, the
 * staff section of its clinic's and branch's detail pages, and a clinic
 * admin's own /staff/team roster — so every mutation has to revalidate all of
 * them or one keeps showing a deactivated account as active. "layout"
 * revalidates the whole /console/clinics subtree because the affected
 * clinic's id isn't known here (the action only receives a user id) and a
 * user can be moved between branches by updateUser.
 *
 * Anything new that renders a user row belongs in this list. It is the one
 * thing about these actions that is easy to forget and invisible when wrong.
 */
function revalidateUserViews(): void {
  revalidatePath("/console/users")
  revalidatePath("/console/clinics", "layout")
  revalidatePath("/staff/team")
}

export async function createUserAction(formData: Record<string, unknown>): Promise<CreateUserResult> {
  const user = await actingUser()
  const parsed = createUserSchema.safeParse(formData)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form for errors." }
  }
  const result = await createUser(user, parsed.data)
  if (result.ok) revalidateUserViews()
  return result
}

export async function updateUserAction(id: string, formData: Record<string, unknown>): Promise<ManageUserResult> {
  const user = await actingUser()
  const parsed = editUserSchema.safeParse(formData)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form for errors." }
  }
  const result = await updateUser(user, id, parsed.data)
  if (result.ok) revalidateUserViews()
  return result
}

export async function setUserActiveAction(id: string, isActive: boolean): Promise<ManageUserResult> {
  const user = await actingUser()
  const result = await setUserActive(user, id, isActive)
  if (result.ok) revalidateUserViews()
  return result
}

export async function changeUserRoleAction(
  id: string,
  formData: Record<string, unknown>
): Promise<ManageUserResult> {
  const user = await actingUser()
  const parsed = changeRoleSchema.safeParse(formData)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form for errors." }
  }
  const result = await changeUserRole(user, id, parsed.data)
  if (result.ok) {
    revalidateUserViews()
    // A role change moves someone in or out of the doctor picker and the
    // branch's staff list, neither of which lives under the paths above.
    revalidatePath("/staff/queue", "layout")
  }
  return result
}

export async function regenerateTempPasswordAction(id: string): Promise<RegenerateTempPasswordResult> {
  const user = await actingUser()
  const result = await regenerateTempPassword(user, id)
  if (result.ok) revalidateUserViews()
  return result
}

export async function forcePasswordResetAction(id: string): Promise<ManageUserResult> {
  const user = await actingUser()
  const result = await forcePasswordReset(user, id)
  if (result.ok) revalidateUserViews()
  return result
}

export async function unlockAccountAction(id: string): Promise<ManageUserResult> {
  const user = await actingUser()
  const result = await unlockAccount(user, id)
  if (result.ok) revalidateUserViews()
  return result
}
