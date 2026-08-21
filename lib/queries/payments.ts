import { runWithRls } from "@/lib/db/rls"
import { requireClinicId, type AbilitySubject } from "@/lib/permissions/ability"
import { todayInstantRange, clinicTimezone } from "@/lib/queries/queue"

export type CollectionEntry = {
  id: string
  patientName: string
  amount: number
  method: string
  receivedAt: Date
}

/** §9 doctor screen "my collections today" — also how M4's accept bar ("today's revenue... attributed to the correct collector") is actually checked. */
export async function listMyCollectionsToday(user: AbilitySubject): Promise<{ entries: CollectionEntry[]; total: number }> {
  const clinicId = requireClinicId(user)
  return runWithRls(user, async (tx) => {
    const timezone = await clinicTimezone(tx, clinicId)
    const { start, end } = todayInstantRange(timezone)

    const payments = await tx.payment.findMany({
      where: { clinicId, collectedByUserId: user.id, receivedAt: { gte: start, lt: end } },
      include: { patient: { select: { firstName: true, lastName: true } } },
      orderBy: { receivedAt: "desc" },
    })

    const entries = payments.map((p) => ({
      id: p.id,
      patientName: `${p.patient.lastName}, ${p.patient.firstName}`,
      amount: p.amount,
      method: p.paymentMethod,
      receivedAt: p.receivedAt,
    }))
    return { entries, total: entries.reduce((sum, e) => sum + e.amount, 0) }
  })
}
