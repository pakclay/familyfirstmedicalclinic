"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import type { MedicineDetailDTO } from "@/lib/dto/medicine"
import { searchMedicinesAction, receiveStockAction } from "./actions"

export function ReceiveStockForm() {
  const [query, setQuery] = useState("")
  const [matches, setMatches] = useState<MedicineDetailDTO[]>([])
  const [selected, setSelected] = useState<MedicineDetailDTO | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [updateExpiry, setUpdateExpiry] = useState(!!selected?.expiryDate)

  async function handleSearch(value: string) {
    setQuery(value)
    setSelected(null)
    if (value.trim().length < 2) {
      setMatches([])
      return
    }
    const results = await searchMedicinesAction(value)
    setMatches(results)
  }

  async function handleSubmit(formData: FormData) {
    if (!selected) return
    setPending(true)
    setError(null)
    setSuccess(null)
    const input = {
      medicineId: selected.id,
      quantity: String(formData.get("quantity") ?? ""),
      unitCost: Math.round(Number(formData.get("unitCostPesos") ?? 0) * 100),
      expiryDate: String(formData.get("expiryDate") ?? ""),
      updateExpiryDate: updateExpiry,
    }
    const res = await receiveStockAction(input)
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setSuccess(`${res.medicineName} received — now ${res.newStock} in stock.`)
    setSelected(null)
    setQuery("")
    setMatches([])
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-4">
        {!selected ? (
          <div className="relative">
            <Label htmlFor="medicine-search">Medicine</Label>
            <Input
              id="medicine-search"
              value={query}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search by name"
              className="mt-1.5 h-10"
              autoFocus
            />
            {matches.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full rounded-md border border-border bg-popover text-popover-foreground shadow-md">
                {matches.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
                      onClick={() => {
                        setSelected(m)
                        setUpdateExpiry(false)
                        setMatches([])
                      }}
                    >
                      <span>
                        {m.name} {m.strength}
                      </span>
                      <span className="font-numeric text-xs text-muted-foreground">{m.currentStock} left</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Can&apos;t find it?{" "}
              <Link href="/staff/inventory/new" className="underline">
                Add a new medicine
              </Link>{" "}
              first.
            </p>
          </div>
        ) : (
          <form action={handleSubmit} className="flex flex-col gap-3">
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
              <span>
                {selected.name} {selected.strength} · {selected.currentStock} currently in stock
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(null)}>
                Change
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="quantity">Quantity received</Label>
                <Input id="quantity" name="quantity" type="number" min={1} required autoFocus className="h-10" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="unitCostPesos">Unit cost (₱)</Label>
                <Input
                  id="unitCostPesos"
                  name="unitCostPesos"
                  type="number"
                  step="0.01"
                  min={0}
                  defaultValue={(selected.unitCost / 100).toFixed(2)}
                  required
                  className="h-10"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="expiryDate">Expiry date (optional)</Label>
              <Input id="expiryDate" name="expiryDate" type="date" className="h-10" />
            </div>
            {selected.expiryDate && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={updateExpiry} onChange={(e) => setUpdateExpiry(e.target.checked)} />
                This delivery&apos;s expiry is later than what&apos;s on file — update the stored expiry date to it
              </label>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={pending} className="h-10">
              {pending ? "Receiving…" : "Receive stock"}
            </Button>
          </form>
        )}
        {success && <p className="text-sm text-brand">{success}</p>}
      </CardContent>
    </Card>
  )
}
