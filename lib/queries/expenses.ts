import { runWithRls } from "@/lib/db/rls"
import { requireBranchId, type AbilitySubject } from "@/lib/permissions/ability"
import { ForbiddenError } from "@/lib/permissions/errors"
import { expenseSchema } from "@/lib/validation/expense"
import { resolveReportInstantRange, type DateRangeParams } from "@/lib/utils/report-dates"

export type ExpenseEntry = {
  id: string
  category: string
  description: string | null
  amount: number
  expenseDate: Date
  recordedByName: string
}

/**
 * §9 Clinic Admin screen "expenses" — the minimal ledger §8's P&L
 * ("expenses, net") needs to mean anything. Resolves the range from the
 * branch's own timezone the same way the reports queries do (§8's other
 * screens) rather than accepting pre-resolved instants from the caller —
 * `Expense.expenseDate` is a `@db.Date` column, and comparing it against a
 * raw `new Date()` instant silently drops "today" for the 8-hour window
 * every day where the branch's calendar date has ticked over but UTC's
 * hasn't yet (the same bug class `todayAsQueueDate` exists to prevent).
 */
export async function listExpenses(
  user: AbilitySubject,
  params: DateRangeParams
): Promise<{ expenses: ExpenseEntry[]; startLabel: string; endLabel: string }> {
  const branchId = requireBranchId(user)
  return runWithRls(user, async (tx) => {
    const branch = await tx.branch.findUniqueOrThrow({ where: { id: branchId }, select: { timezone: true } })
    const { startLabel, endLabel } = resolveReportInstantRange(params, branch.timezone)
    const [sy, sm, sd] = startLabel.split("-").map(Number)
    const [ey, em, ed] = endLabel.split("-").map(Number)
    const start = new Date(Date.UTC(sy, sm - 1, sd))
    const end = new Date(Date.UTC(ey, em - 1, ed))
    const rows = await tx.expense.findMany({
      where: { branchId, expenseDate: { gte: start, lte: end } },
      include: { recordedByUser: { select: { name: true } } },
      orderBy: { expenseDate: "desc" },
    })
    return {
      expenses: rows.map((e) => ({
        id: e.id,
        category: e.category,
        description: e.description,
        amount: e.amount,
        expenseDate: e.expenseDate,
        recordedByName: e.recordedByUser.name,
      })),
      startLabel,
      endLabel,
    }
  })
}

export async function createExpense(user: AbilitySubject, input: unknown): Promise<void> {
  if (user.role !== "CLINIC_ADMIN") throw new ForbiddenError("Only a clinic admin can record expenses")
  const branchId = requireBranchId(user)
  const parsed = expenseSchema.parse(input)

  await runWithRls(user, async (tx) => {
    const expense = await tx.expense.create({
      data: {
        branchId,
        category: parsed.category,
        description: parsed.description || null,
        amount: parsed.amount,
        expenseDate: parsed.expenseDate,
        recordedByUserId: user.id,
      },
    })
    await tx.auditLog.create({
      data: { branchId, userId: user.id, action: "expense.create", entityType: "Expense", entityId: expense.id, changes: { amount: expense.amount } },
    })
  })
}
