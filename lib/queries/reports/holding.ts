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
    // here assumes that. So the aggregates are batched *per distinct
    // timezone* rather than per branch: branches sharing a zone share one
    // calendar range, and therefore one set of grouped queries.
    //
    // This used to be a `for` loop over branches issuing three aggregates
    // each — 1 + 3N statements, and because an interactive transaction runs
    // on a single connection, the inner `Promise.all` did not overlap them
    // either. Every one was a sequential round trip, which is what made this
    // the slowest screen in the console. It is now 1 + 3×(distinct zones),
    // i.e. four statements for any number of branches in one timezone, and
    // it degrades to the old cost only in the case it was always paying for.
    const byTimezone = new Map<string, string[]>()
    for (const branch of branches) {
      const ids = byTimezone.get(branch.timezone)
      if (ids) ids.push(branch.id)
      else byTimezone.set(branch.timezone, [branch.id])
    }

    const revenueByBranch = new Map<string, number>()
    const expensesByBranch = new Map<string, number>()
    const visitsByBranch = new Map<string, number>()

    for (const [timezone, branchIds] of byTimezone) {
      const instantRange = resolveReportInstantRange(params, timezone)
      const dateOnlyRange = resolveReportDateOnlyRange(params, timezone)

      const [revenueRows, expenseRows, visitRows] = await Promise.all([
        tx.payment.groupBy({
          by: ["branchId"],
          where: { branchId: { in: branchIds }, receivedAt: { gte: instantRange.start, lt: instantRange.end } },
          _sum: { amount: true },
        }),
        tx.expense.groupBy({
          by: ["branchId"],
          where: { branchId: { in: branchIds }, expenseDate: { gte: dateOnlyRange.start, lte: dateOnlyRange.end } },
          _sum: { amount: true },
        }),
        tx.queueEntry.groupBy({
          by: ["branchId"],
          where: { branchId: { in: branchIds }, checkedInAt: { gte: instantRange.start, lt: instantRange.end } },
          _count: { _all: true },
        }),
      ])

      // A branch with no rows in range is simply absent from the grouped
      // result, which is the same zero the per-branch aggregate produced.
      for (const row of revenueRows) revenueByBranch.set(row.branchId, row._sum.amount ?? 0)
      for (const row of expenseRows) expensesByBranch.set(row.branchId, row._sum.amount ?? 0)
      for (const row of visitRows) visitsByBranch.set(row.branchId, row._count._all)
    }

    const summaries: HoldingBranchSummary[] = branches.map((branch) => {
      const revenueTotal = revenueByBranch.get(branch.id) ?? 0
      const expensesTotal = expensesByBranch.get(branch.id) ?? 0
      return {
        branchId: branch.id,
        branchName: branch.name,
        clinicName: branch.clinic.name,
        revenueTotal,
        expensesTotal,
        net: revenueTotal - expensesTotal,
        visitCount: visitsByBranch.get(branch.id) ?? 0,
      }
    })

    // Unchanged: the range shown in the heading is the last branch's, which
    // only differs from the others if the company spans timezones.
    const labelTimezone = branches[branches.length - 1]?.timezone
    const labels = labelTimezone ? resolveReportInstantRange(params, labelTimezone) : null
    const startLabel = labels?.startLabel ?? ""
    const endLabel = labels?.endLabel ?? ""

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
