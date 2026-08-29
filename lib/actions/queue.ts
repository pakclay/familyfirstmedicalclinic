"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { ForbiddenError } from "@/lib/permissions/errors"
import type { AbilitySubject } from "@/lib/permissions/ability"
import {
  callNextEntry,
  checkInBookedEntry,
  assignDoctor,
  recallEntry,
  markNoShow,
  startConsultationForQueueEntry,
  moveQueueEntryOrder,
  type StaffQueueEntryDTO,
} from "@/lib/queries/queue"
import { recordVitals, type RecordVitalsResult } from "@/lib/queries/vitals"

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

export async function callNextAction(): Promise<StaffQueueEntryDTO | null> {
  const user = await actingUser()
  const result = await callNextEntry(user)
  revalidatePath("/staff/queue")
  revalidatePath("/doctor/queue")
  return result
}

/**
 * Returns a result object rather than throwing, unlike its neighbours here:
 * a rejected vitals reading is a correctable typo the person needs to see
 * next to the field, not a failed operation. Revalidates the doctor queue
 * too, so a reading taken at the desk reaches a consultation screen already
 * open on it.
 */
export async function recordVitalsAction(queueEntryId: string, input: unknown): Promise<RecordVitalsResult> {
  const user = await actingUser()
  const result = await recordVitals(user, queueEntryId, input)
  if (result.ok) {
    revalidatePath("/staff/queue")
    revalidatePath("/doctor/queue")
  }
  return result
}

export async function checkInAction(queueEntryId: string): Promise<void> {
  const user = await actingUser()
  await checkInBookedEntry(user, queueEntryId)
  revalidatePath("/staff/queue")
}

export async function assignDoctorAction(queueEntryId: string, doctorId: string): Promise<void> {
  const user = await actingUser()
  await assignDoctor(user, queueEntryId, doctorId)
  revalidatePath("/staff/queue")
  revalidatePath("/doctor/queue")
}

export async function recallAction(queueEntryId: string): Promise<void> {
  const user = await actingUser()
  await recallEntry(user, queueEntryId)
  revalidatePath("/staff/queue")
}

export async function noShowAction(queueEntryId: string): Promise<void> {
  const user = await actingUser()
  await markNoShow(user, queueEntryId)
  revalidatePath("/staff/queue")
  revalidatePath("/doctor/queue")
}

export async function startConsultationAction(queueEntryId: string): Promise<void> {
  const user = await actingUser()
  await startConsultationForQueueEntry(user, queueEntryId)
  revalidatePath("/staff/queue")
  revalidatePath("/doctor/queue")
}

export async function moveOrderAction(queueEntryId: string, direction: "up" | "down"): Promise<void> {
  const user = await actingUser()
  await moveQueueEntryOrder(user, queueEntryId, direction)
  revalidatePath("/staff/queue")
}
