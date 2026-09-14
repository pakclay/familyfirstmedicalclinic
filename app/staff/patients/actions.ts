"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { ForbiddenError } from "@/lib/permissions/errors"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { checkInExistingPatient } from "@/lib/queries/patients"
import { queueCheckInSchema } from "@/lib/validation/patient"
import type { QueueEntryDTO } from "@/lib/dto/queue-entry"
import { isDatabaseError, DATABASE_ERROR_MESSAGE } from "@/lib/db/errors"

async function actingUser(): Promise<AbilitySubject> {
  const session = await auth()
  if (!session?.user) throw new ForbiddenError("Not signed in")
  return {
    id: session.user.id,
    role: session.user.role,
    branchId: session.user.branchId,
    clinicId: session.user.clinicId,
    holdingCompanyId: session.user.holdingCompanyId,
  }
}

export type AddToQueueResult = { ok: true; queueEntry: QueueEntryDTO } | { ok: false; error: string }

/**
 * "Add to queue" from the patient search: the same check-in the register
 * screen performs for a patient it found, reached from the other place the
 * desk finds people. Returns a result rather than throwing because the one
 * expected failure — the patient already holds a place in today's queue —
 * is something the desk needs to read, and a thrown server-action error
 * reaches the browser with its message stripped in production.
 */
export async function addToQueueAction(patientId: string, input: unknown): Promise<AddToQueueResult> {
  const user = await actingUser()
  const parsed = queueCheckInSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form for errors." }
  }
  try {
    const queueEntry = await checkInExistingPatient(user, patientId, parsed.data)
    revalidatePath("/staff/patients")
    revalidatePath("/staff/queue")
    return { ok: true, queueEntry }
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message }
    if (isDatabaseError(err)) {
      console.error("[patients] addToQueue failed at the database", err)
      return { ok: false, error: DATABASE_ERROR_MESSAGE }
    }
    if (err instanceof Error) return { ok: false, error: err.message }
    return { ok: false, error: "Something went wrong. Please try again." }
  }
}
