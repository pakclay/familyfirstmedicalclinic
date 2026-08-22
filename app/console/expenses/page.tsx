import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { listExpenses } from "@/lib/queries/expenses"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { NewExpenseForm } from "./new-expense-form"

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string; end?: string }>
}) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (session.user.role !== "CLINIC_ADMIN") {
    return (
      <div>
        <h1 className="text-2xl font-heading font-semibold">Expenses</h1>
        <p className="mt-2 text-sm text-muted-foreground">Only a clinic admin manages expenses.</p>
      </div>
    )
  }

  const { start, end } = await searchParams

  const user: AbilitySubject = {
    id: session.user.id,
    role: session.user.role,
    clinicId: session.user.clinicId,
    holdingCompanyId: session.user.holdingCompanyId,
  }
  const { expenses, startLabel, endLabel } = await listExpenses(user, { start, end })
  const total = expenses.reduce((sum, e) => sum + e.amount, 0)

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-heading font-semibold">Expenses</h1>

      <div className="mt-4">
        <NewExpenseForm />
      </div>

      <form className="mt-6 flex items-end gap-2" action="/console/expenses">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground" htmlFor="start">From</label>
          <Input id="start" name="start" type="date" defaultValue={startLabel} className="h-9" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground" htmlFor="end">To</label>
          <Input id="end" name="end" type="date" defaultValue={endLabel} className="h-9" />
        </div>
        <Button type="submit" variant="outline" className="h-9">
          Filter
        </Button>
      </form>

      <p className="mt-4 text-sm text-muted-foreground">
        Total: <span className="font-numeric text-foreground">₱{(total / 100).toFixed(2)}</span>
      </p>
      <ul className="mt-2 divide-y divide-border rounded-md border border-border">
        {expenses.map((e) => (
          <li key={e.id} className="flex items-center justify-between px-4 py-3 text-sm">
            <div>
              <p>
                {e.category}
                {e.description && <span className="text-muted-foreground"> — {e.description}</span>}
              </p>
              <p className="text-xs text-muted-foreground">
                {e.expenseDate.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" })} · {e.recordedByName}
              </p>
            </div>
            <span className="font-numeric">₱{(e.amount / 100).toFixed(2)}</span>
          </li>
        ))}
        {expenses.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">No expenses in this range.</li>
        )}
      </ul>
    </div>
  )
}
