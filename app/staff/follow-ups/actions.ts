"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { ForbiddenError } from "@/lib/permissions/errors"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { sendFollowUpReminder } from "@/lib/queries/notifications"

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

export async function sendFollowUpReminderAction(consultationId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await actingUser()
  try {
    await sendFollowUpReminder(user, consultationId)
    revalidatePath("/staff/follow-ups")
    return { ok: true }
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message }
    return { ok: false, error: "Something went wrong. Please try again." }
  }
}
