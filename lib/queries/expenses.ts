import { runWithRls } from "@/lib/db/rls"
import { requireClinicId, type AbilitySubject } from "@/lib/permissions/ability"
import { ForbiddenError } from "@/lib/permissions/errors"
import { expenseSchema } from "@/lib/validation/expense"

export type ExpenseEntry = {
  id: string
  category: string
  description: string | null
  amount: number
  expenseDate: Date
  recordedByName: string
}

/** §9 Clinic Admin screen "expenses" — the minimal ledger §8's P&L ("expenses, net") needs to mean anything. */
export async function listExpenses(user: AbilitySubject, range: { start: Date; end: Date }): Promise<ExpenseEntry[]> {
  const clinicId = requireClinicId(user)
  return runWithRls(user, async (tx) => {
    const expenses = await tx.expense.findMany({
      where: { clinicId, expenseDate: { gte: range.start, lte: range.end } },
      include: { recordedByUser: { select: { name: true } } },
      orderBy: { expenseDate: "desc" },
    })
    return expenses.map((e) => ({
      id: e.id,
      category: e.category,
      description: e.description,
      amount: e.amount,
      expenseDate: e.expenseDate,
      recordedByName: e.recordedByUser.name,
    }))
  })
}

export async function createExpense(user: AbilitySubject, input: unknown): Promise<void> {
  if (user.role !== "CLINIC_ADMIN") throw new ForbiddenError("Only a clinic admin can record expenses")
  const clinicId = requireClinicId(user)
  const parsed = expenseSchema.parse(input)

  await runWithRls(user, async (tx) => {
    const expense = await tx.expense.create({
      data: {
        clinicId,
        category: parsed.category,
        description: parsed.description || null,
        amount: parsed.amount,
        expenseDate: parsed.expenseDate,
        recordedByUserId: user.id,
      },
    })
    await tx.auditLog.create({
      data: { clinicId, userId: user.id, action: "expense.create", entityType: "Expense", entityId: expense.id, changes: { amount: expense.amount } },
    })
  })
}
