"use server"

import { auth, signOut } from "@/auth"
import { changePasswordSchema } from "@/lib/validation/password"
import { changeOwnPassword } from "@/lib/queries/users"
import { ForbiddenError } from "@/lib/permissions/errors"
import type { AbilitySubject } from "@/lib/permissions/ability"

export type ChangePasswordState = { error: string | null }

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

export async function changePasswordAction(
  _prev: ChangePasswordState,
  formData: FormData
): Promise<ChangePasswordState> {
  const user = await actingUser()

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form for errors." }
  }

  const result = await changeOwnPassword(user, parsed.data.currentPassword, parsed.data.newPassword)
  if (!result.ok) {
    return { error: result.error }
  }

  // Sign out rather than trying to refresh the live session: proxy.ts reads
  // mustChangePassword straight off the JWT via auth.config.ts's Prisma-free
  // callbacks (see proxy.ts), which only gets re-signed on a fresh sign-in —
  // not on this server action's response. A forced re-login is also the
  // more legible UX after a password change either way.
  await signOut({ redirectTo: "/login?passwordChanged=1" })
  return { error: null }
}
