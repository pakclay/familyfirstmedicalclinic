"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { submitRemittanceAction } from "./actions"

export function RemittanceForm({ expectedAmount }: { expectedAmount: number }) {
  const router = useRouter()
  const [amount, setAmount] = useState((expectedAmount / 100).toFixed(2))
  const [notes, setNotes] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const res = await submitRemittanceAction(Number(amount), notes)
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="actual">Cash actually handed over (₱)</Label>
        <Input id="actual" type="number" step="0.01" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} className="h-11" required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="notes">Notes (optional)</Label>
        <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="h-10" />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending} className="h-11">
        {pending ? "Submitting…" : "Submit remittance"}
      </Button>
    </form>
  )
}
