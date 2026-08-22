import { runWithRls } from "@/lib/db/rls"
import { ForbiddenError } from "@/lib/permissions/errors"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { resolveReportInstantRange, resolveReportDateOnlyRange, type DateRangeParams } from "@/lib/utils/report-dates"

export type HoldingClinicSummary = {
  clinicId: string
  clinicName: string
  revenueTotal: number
  expensesTotal: number
  net: number
  visitCount: number
}

export type HoldingReportData = {
  startLabel: string
  endLabel: string
  clinics: HoldingClinicSummary[]
  consolidated: { revenueTotal: number; expensesTotal: number; net: number }
  rankingByRevenue: HoldingClinicSummary[]
  rankingByVolume: HoldingClinicSummary[]
}

/**
 * §8 "Holding level": all clinics side by side, consolidated P&L, and a
 * ranking by revenue and volume. §12/M6's accept line is specifically
 * about this report — "per-clinic revenue totals reconcile exactly to
 * the sum of payment rows" — so `revenueTotal` here is a direct
 * `SUM(payments.amount)` per clinic with no intermediate rounding or
 * derived-from-something-else shortcut that could quietly drift from it.
 */
export async function getHoldingConsolidatedReport(user: AbilitySubject, params: DateRangeParams): Promise<HoldingReportData> {
  if (user.role !== "HOLDING_ADMIN") throw new ForbiddenError("Only a holding admin sees the consolidated report")
  if (!user.holdingCompanyId) throw new ForbiddenError("This account isn't attached to a holding company")

  return runWithRls(user, async (tx) => {
    const clinics = await tx.clinic.findMany({
      where: { holdingCompanyId: user.holdingCompanyId! },
      select: { id: true, name: true, timezone: true },
      orderBy: { name: "asc" },
    })

    // Each clinic resolves the same calendar range against its own
    // timezone — in practice every seeded clinic is Asia/Manila, but nothing
    // here assumes that.
    const summaries: HoldingClinicSummary[] = []
    let startLabel = ""
    let endLabel = ""

    for (const clinic of clinics) {
      const instantRange = resolveReportInstantRange(params, clinic.timezone)
      const dateOnlyRange = resolveReportDateOnlyRange(params, clinic.timezone)
      startLabel = instantRange.startLabel
      endLabel = instantRange.endLabel

      const [revenueAgg, expenseAgg, visitCount] = await Promise.all([
        tx.payment.aggregate({
          where: { clinicId: clinic.id, receivedAt: { gte: instantRange.start, lt: instantRange.end } },
          _sum: { amount: true },
        }),
        tx.expense.aggregate({
          where: { clinicId: clinic.id, expenseDate: { gte: dateOnlyRange.start, lte: dateOnlyRange.end } },
          _sum: { amount: true },
        }),
        tx.queueEntry.count({
          where: { clinicId: clinic.id, checkedInAt: { gte: instantRange.start, lt: instantRange.end } },
        }),
      ])

      const revenueTotal = revenueAgg._sum.amount ?? 0
      const expensesTotal = expenseAgg._sum.amount ?? 0
      summaries.push({
        clinicId: clinic.id,
        clinicName: clinic.name,
        revenueTotal,
        expensesTotal,
        net: revenueTotal - expensesTotal,
        visitCount,
      })
    }

    const consolidated = summaries.reduce(
      (acc, s) => ({
        revenueTotal: acc.revenueTotal + s.revenueTotal,
        expensesTotal: acc.expensesTotal + s.expensesTotal,
        net: acc.net + s.net,
      }),
      { revenueTotal: 0, expensesTotal: 0, net: 0 }
    )

    return {
      startLabel,
      endLabel,
      clinics: summaries,
      consolidated,
      rankingByRevenue: [...summaries].sort((a, b) => b.revenueTotal - a.revenueTotal),
      rankingByVolume: [...summaries].sort((a, b) => b.visitCount - a.visitCount),
    }
  })
}
