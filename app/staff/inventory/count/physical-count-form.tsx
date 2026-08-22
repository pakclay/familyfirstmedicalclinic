"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import type { MedicineDetailDTO } from "@/lib/dto/medicine"
import type { PhysicalCountResult } from "@/lib/queries/inventory"
import { submitPhysicalCountAction } from "./actions"

export function PhysicalCountForm({ medicines }: { medicines: MedicineDetailDTO[] }) {
  const [counted, setCounted] = useState<Record<string, string>>({})
  const [reason, setReason] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PhysicalCountResult | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const counts = Object.entries(counted)
      .filter(([, v]) => v.trim() !== "")
      .map(([medicineId, v]) => ({ medicineId, countedQuantity: v }))
    if (counts.length === 0) {
      setError("Enter a counted quantity for at least one medicine.")
      return
    }
    setPending(true)
    const res = await submitPhysicalCountAction({ reason, counts })
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setResult(res.result)
    setCounted({})
  }

  if (result) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
          <p className="text-sm text-muted-foreground">Count submitted</p>
          <p className="font-numeric text-4xl font-bold text-brand">
            {result.discrepancies} discrepanc{result.discrepancies === 1 ? "y" : "ies"}
          </p>
          <p className="text-sm text-muted-foreground">
            Total variance: {result.totalVarianceCentavos >= 0 ? "+" : ""}
            ₱{(result.totalVarianceCentavos / 100).toFixed(2)}
          </p>
          <Button className="mt-4 h-10" onClick={() => setResult(null)}>
            Count again
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reason">Reason (applies to every discrepancy this count finds)</Label>
        <Input
          id="reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Monthly physical count"
          required
          className="h-10"
        />
      </div>

      <ul className="divide-y divide-border rounded-md border border-border">
        {medicines.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
            <div>
              <p>
                {m.name} {m.strength}
              </p>
              <p className="text-xs text-muted-foreground">System: {m.currentStock}</p>
            </div>
            <Input
              type="number"
              min={0}
              placeholder="Counted"
              value={counted[m.id] ?? ""}
              onChange={(e) => setCounted((c) => ({ ...c, [m.id]: e.target.value }))}
              className="h-9 w-24"
            />
          </li>
        ))}
        {medicines.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">No medicines to count.</li>
        )}
      </ul>

      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending} className="h-11">
        {pending ? "Submitting…" : "Submit count"}
      </Button>
    </form>
  )
}
