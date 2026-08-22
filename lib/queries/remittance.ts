import { runWithRls } from "@/lib/db/rls"
import { requireClinicId, type AbilitySubject } from "@/lib/permissions/ability"
import { ForbiddenError } from "@/lib/permissions/errors"
import { todayAsQueueDate, clinicTimezone } from "@/lib/queries/queue"
import { listMyCollectionsToday } from "@/lib/queries/payments"

export type RemittanceStatus = {
  expectedAmount: number
  alreadySubmitted: { id: string; actualAmount: number; variance: number; confirmed: boolean } | null
}

/** §7.7: "shows each collector their total recorded payments for the day" — before they enter what they actually handed over. */
export async function getMyRemittanceStatus(user: AbilitySubject): Promise<RemittanceStatus> {
  const clinicId = requireClinicId(user)
  const { total } = await listMyCollectionsToday(user)

  return runWithRls(user, async (tx) => {
    const timezone = await clinicTimezone(tx, clinicId)
    const shiftDate = todayAsQueueDate(timezone)
    const existing = await tx.remittance.findFirst({
      where: { clinicId, userId: user.id, shiftDate },
      orderBy: { createdAt: "desc" },
    })
    return {
      expectedAmount: total,
      alreadySubmitted: existing
        ? { id: existing.id, actualAmount: existing.actualAmount, variance: existing.variance, confirmed: !!existing.confirmedByUserId }
        : null,
    }
  })
}

/** §7.7: records the variance between what the system shows and what the collector actually hands over — expectedAmount is always computed server-side, never trusted from the client. */
export async function submitRemittance(user: AbilitySubject, actualAmount: number, notes?: string): Promise<void> {
  const clinicId = requireClinicId(user)
  const { total: expectedAmount } = await listMyCollectionsToday(user)

  await runWithRls(user, async (tx) => {
    const timezone = await clinicTimezone(tx, clinicId)
    const shiftDate = todayAsQueueDate(timezone)
    const remittance = await tx.remittance.create({
      data: {
        clinicId,
        userId: user.id,
        shiftDate,
        expectedAmount,
        actualAmount,
        variance: actualAmount - expectedAmount,
        notes: notes || null,
      },
    })
    await tx.auditLog.create({
      data: {
        clinicId,
        userId: user.id,
        action: "remittance.submit",
        entityType: "Remittance",
        entityId: remittance.id,
        changes: { expectedAmount, actualAmount, variance: remittance.variance },
      },
    })
  })
}

export type PendingRemittance = {
  id: string
  collectorName: string
  shiftDate: Date
  expectedAmount: number
  actualAmount: number
  variance: number
  remittedAt: Date
  notes: string | null
}

/** For the clinic admin to confirm — §7.7: "the system records the variance for the clinic admin to confirm." */
export async function listPendingRemittances(user: AbilitySubject): Promise<PendingRemittance[]> {
  if (user.role !== "CLINIC_ADMIN") throw new ForbiddenError("Only a clinic admin confirms remittances")
  const clinicId = requireClinicId(user)
  return runWithRls(user, async (tx) => {
    const remittances = await tx.remittance.findMany({
      where: { clinicId, confirmedByUserId: null },
      include: { user: { select: { name: true } } },
      orderBy: { remittedAt: "asc" },
    })
    return remittances.map((r) => ({
      id: r.id,
      collectorName: r.user.name,
      shiftDate: r.shiftDate,
      expectedAmount: r.expectedAmount,
      actualAmount: r.actualAmount,
      variance: r.variance,
      remittedAt: r.remittedAt,
      notes: r.notes,
    }))
  })
}

export async function confirmRemittance(user: AbilitySubject, remittanceId: string): Promise<void> {
  if (user.role !== "CLINIC_ADMIN") throw new ForbiddenError("Only a clinic admin confirms remittances")
  const clinicId = requireClinicId(user)
  await runWithRls(user, async (tx) => {
    const remittance = await tx.remittance.findFirst({ where: { id: remittanceId, clinicId } })
    if (!remittance) throw new ForbiddenError("Remittance not found in your clinic")
    await tx.remittance.update({ where: { id: remittanceId }, data: { confirmedByUserId: user.id } })
    await tx.auditLog.create({
      data: { clinicId, userId: user.id, action: "remittance.confirm", entityType: "Remittance", entityId: remittanceId },
    })
  })
}
