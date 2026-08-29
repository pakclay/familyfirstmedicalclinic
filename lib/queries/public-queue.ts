import { prisma } from "@/lib/db/prisma"
import { runWithBranchScope, runWithFullVisibility } from "@/lib/db/rls"
import { ACTIVE_STATUSES, todayAsQueueDate } from "@/lib/queries/queue"
import { compareQueueOrder } from "@/lib/utils/queue-order"
import { publicBranchName } from "@/lib/queries/public-branch-name"

/** A rough MVP heuristic (§7.3's "estimated wait") — refine with a real average once M6 reporting exists. */
const AVERAGE_MINUTES_PER_PATIENT = 15

export type PublicDisplayState = {
  clinicName: string
  nowServing: number | null
  next: number[]
}

/**
 * §7.3 `/display/{branch_slug}`: waiting-room TV/tablet. §10 hard rule —
 * "Never expose patient names on the public waiting-room display" — this
 * returns queue *numbers* only, nothing patient-identifying, not even a
 * patientId a caller could chain into another lookup.
 *
 * `clinicName` below is patient-facing copy, not a code identifier — see
 * booking.ts's header comment for why that wording stays even though the
 * data now comes from Branch.
 */
export async function getPublicDisplayState(branchSlug: string): Promise<PublicDisplayState | null> {
  const branch = await prisma.branch.findUnique({
    where: { slug: branchSlug, isActive: true },
    include: { clinic: { select: { name: true } } },
  })
  if (!branch) return null

  return runWithBranchScope(branch.id, async (tx) => {
    const queueDate = todayAsQueueDate(branch.timezone)

    const nowServingEntry = await tx.queueEntry.findFirst({
      where: { branchId: branch.id, queueDate, status: { in: ["CALLED", "IN_CONSULTATION"] } },
      orderBy: { calledAt: "desc" },
      select: { queueNumber: true },
    })

    const upcoming = await tx.queueEntry.findMany({
      where: { branchId: branch.id, queueDate, status: { in: ACTIVE_STATUSES } },
      select: { queueNumber: true, priority: true, checkedInAt: true },
    })
    upcoming.sort(compareQueueOrder)

    return {
      clinicName: publicBranchName(branch),
      nowServing: nowServingEntry?.queueNumber ?? null,
      next: upcoming.slice(0, 3).map((e) => e.queueNumber),
    }
  })
}

export type PatientStatus = {
  queueNumber: number
  status: string
  nowServing: number | null
  patientsAhead: number
  estimatedWaitMinutes: number
  clinicName: string
  clinicAddress: string
}

/**
 * §7.3 `/q/{access_token}`. Token possession is the authorization (§10) —
 * see `runWithFullVisibility`'s doc comment for why this doesn't (and
 * can't) scope by branch up front. Returns null for an unknown token *or*
 * one whose `queueDate` isn't today: §10 requires access tokens to
 * "expire at end of day," and a booked-for-tomorrow token simply isn't
 * live yet rather than being treated as already expired.
 */
export async function getPatientStatusByToken(accessToken: string): Promise<PatientStatus | null> {
  return runWithFullVisibility(async (tx) => {
    const entry = await tx.queueEntry.findUnique({
      where: { accessToken },
      include: { branch: { select: { name: true, address: true, timezone: true, clinic: { select: { name: true } } } } },
    })
    if (!entry) return null

    const today = todayAsQueueDate(entry.branch.timezone)
    if (entry.queueDate.getTime() !== today.getTime()) return null

    const active = await tx.queueEntry.findMany({
      where: { branchId: entry.branchId, queueDate: entry.queueDate, status: { in: ACTIVE_STATUSES } },
      select: { id: true, priority: true, checkedInAt: true },
    })
    active.sort(compareQueueOrder)
    const position = active.findIndex((e) => e.id === entry.id)
    const patientsAhead = position >= 0 ? position : 0

    const nowServingEntry = await tx.queueEntry.findFirst({
      where: { branchId: entry.branchId, queueDate: entry.queueDate, status: { in: ["CALLED", "IN_CONSULTATION"] } },
      orderBy: { calledAt: "desc" },
      select: { queueNumber: true },
    })

    return {
      queueNumber: entry.queueNumber,
      status: entry.status,
      nowServing: nowServingEntry?.queueNumber ?? null,
      patientsAhead,
      estimatedWaitMinutes: patientsAhead * AVERAGE_MINUTES_PER_PATIENT,
      clinicName: publicBranchName(entry.branch),
      clinicAddress: entry.branch.address,
    }
  })
}
