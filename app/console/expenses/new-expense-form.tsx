"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { createExpenseAction } from "./actions"

export function NewExpenseForm() {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(formData: FormData) {
    setPending(true)
    setError(null)
    const input = {
      category: String(formData.get("category") ?? ""),
      description: String(formData.get("description") ?? ""),
      amount: Math.round(Number(formData.get("amountPesos") ?? 0) * 100),
      expenseDate: String(formData.get("expenseDate") ?? ""),
    }
    const res = await createExpenseAction(input)
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    router.refresh()
    ;(document.getElementById("new-expense-form") as HTMLFormElement | null)?.reset()
  }

  const today = new Date().toISOString().slice(0, 10)

  return (
    <Card>
      <CardContent className="py-4">
        <form id="new-expense-form" action={handleSubmit} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="category">Category</Label>
              <Input id="category" name="category" placeholder="e.g. Rent, Utilities, Supplies" required className="h-10" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="amountPesos">Amount (₱)</Label>
              <Input id="amountPesos" name="amountPesos" type="number" step="0.01" min={0.01} required className="h-10" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="expenseDate">Date</Label>
              <Input id="expenseDate" name="expenseDate" type="date" defaultValue={today} required className="h-10" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="description">Description (optional)</Label>
              <Input id="description" name="description" className="h-10" />
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={pending} className="h-10">
            {pending ? "Adding…" : "Add expense"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
