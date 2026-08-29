import { runWithRls } from "@/lib/db/rls"
import { ForbiddenError } from "@/lib/permissions/errors"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { resolveReportInstantRange, resolveReportDateOnlyRange, type DateRangeParams } from "@/lib/utils/report-dates"

export type HoldingBranchSummary = {
  branchId: string
  branchName: string
  clinicName: string
  revenueTotal: number
  expensesTotal: number
  net: number
  visitCount: number
}

export type HoldingReportData = {
  startLabel: string
  endLabel: string
  branches: HoldingBranchSummary[]
  consolidated: { revenueTotal: number; expensesTotal: number; net: number }
  rankingByRevenue: HoldingBranchSummary[]
  rankingByVolume: HoldingBranchSummary[]
}

/**
 * §8 "Holding level": all branches side by side (labeled by their parent
 * clinic), consolidated P&L, and a ranking by revenue and volume. §12/M6's
 * accept line is specifically about this report — "per-clinic revenue
 * totals reconcile exactly to the sum of payment rows" — so `revenueTotal`
 * here is a direct `SUM(payments.amount)` per branch with no intermediate
 * rounding or derived-from-something-else shortcut that could quietly
 * drift from it. Grouped by branch rather than clinic because that's
 * where revenue/expenses/visits actually happen now — a clinic with
 * multiple branches is the sum of its branches' rows, not a query target
 * of its own.
 */
export async function getHoldingConsolidatedReport(user: AbilitySubject, params: DateRangeParams): Promise<HoldingReportData> {
  if (user.role !== "HOLDING_ADMIN") throw new ForbiddenError("Only a holding admin sees the consolidated report")
  if (!user.holdingCompanyId) throw new ForbiddenError("This account isn't attached to a holding company")

  return runWithRls(user, async (tx) => {
    const branches = await tx.branch.findMany({
      where: { clinic: { holdingCompanyId: user.holdingCompanyId! } },
      select: { id: true, name: true, timezone: true, clinic: { select: { name: true } } },
      orderBy: [{ clinic: { name: "asc" } }, { name: "asc" }],
    })

    // Each branch resolves the same calendar range against its own
    // timezone — in practice every seeded branch is Asia/Manila, but nothing
    // here assumes that.
    const summaries: HoldingBranchSummary[] = []
    let startLabel = ""
    let endLabel = ""

    for (const branch of branches) {
      const instantRange = resolveReportInstantRange(params, branch.timezone)
      const dateOnlyRange = resolveReportDateOnlyRange(params, branch.timezone)
      startLabel = instantRange.startLabel
      endLabel = instantRange.endLabel

      const [revenueAgg, expenseAgg, visitCount] = await Promise.all([
        tx.payment.aggregate({
          where: { branchId: branch.id, receivedAt: { gte: instantRange.start, lt: instantRange.end } },
          _sum: { amount: true },
        }),
        tx.expense.aggregate({
          where: { branchId: branch.id, expenseDate: { gte: dateOnlyRange.start, lte: dateOnlyRange.end } },
          _sum: { amount: true },
        }),
        tx.queueEntry.count({
          where: { branchId: branch.id, checkedInAt: { gte: instantRange.start, lt: instantRange.end } },
        }),
      ])

      const revenueTotal = revenueAgg._sum.amount ?? 0
      const expensesTotal = expenseAgg._sum.amount ?? 0
      summaries.push({
        branchId: branch.id,
        branchName: branch.name,
        clinicName: branch.clinic.name,
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
      branches: summaries,
      consolidated,
      rankingByRevenue: [...summaries].sort((a, b) => b.revenueTotal - a.revenueTotal),
      rankingByVolume: [...summaries].sort((a, b) => b.visitCount - a.visitCount),
    }
  })
}
