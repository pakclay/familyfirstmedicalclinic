"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { recordVitalsAction } from "@/lib/actions/queue"

type Vitals = { bp: string; temp: string; weight: string; height: string; pulse: string }

const FIELDS: { key: keyof Vitals; label: string; hint: string; inputMode?: "decimal" }[] = [
  { key: "temp", label: "Temp", hint: "°C", inputMode: "decimal" },
  { key: "weight", label: "Weight", hint: "kg", inputMode: "decimal" },
  { key: "height", label: "Height", hint: "cm", inputMode: "decimal" },
  { key: "pulse", label: "Pulse", hint: "bpm", inputMode: "decimal" },
  { key: "bp", label: "BP", hint: "120/80" },
]

/** Order matters: this is the order the numbers come off the equipment, not alphabetical. */
function fromRecord(v: Record<string, string>): Vitals {
  return {
    bp: v.bp ?? "",
    temp: v.temp ?? "",
    weight: v.weight ?? "",
    height: v.height ?? "",
    pulse: v.pulse ?? "",
  }
}

export function VitalsForm({
  queueEntryId,
  patientName,
  initial,
  onDone,
}: {
  queueEntryId: string
  patientName: string
  initial: Record<string, string>
  onDone: () => void
}) {
  const [vitals, setVitals] = useState<Vitals>(fromRecord(initial))
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function set<K extends keyof Vitals>(key: K, value: string) {
    setVitals((v) => ({ ...v, [key]: value }))
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await recordVitalsAction(queueEntryId, vitals)
      if (!result.ok) {
        setError(result.error)
        return
      }
      onDone()
    })
  }

  return (
    <form onSubmit={submit} className="mt-3 rounded-md border border-border p-3">
      <p className="text-xs font-medium uppercase text-muted-foreground">Vitals — {patientName}</p>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {FIELDS.map((f) => (
          <div key={f.key} className="flex flex-col gap-1">
            <Label htmlFor={`${queueEntryId}-${f.key}`} className="text-xs">
              {f.label} <span className="text-muted-foreground">{f.hint}</span>
            </Label>
            <Input
              id={`${queueEntryId}-${f.key}`}
              // Not type="number": BP is not numeric, and a number input
              // silently discards what it cannot parse, so a mistyped weight
              // would vanish rather than be corrected.
              inputMode={f.inputMode}
              value={vitals[f.key]}
              onChange={(e) => set(f.key, e.target.value)}
              className="h-10"
              autoComplete="off"
            />
          </div>
        ))}
      </div>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      <div className="mt-3 flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save vitals"}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

/** Compact read-only summary for a queue row — shows at a glance whether vitals still need taking. */
export function VitalsSummary({ vitals }: { vitals: Record<string, string> }) {
  const parts = FIELDS.filter((f) => vitals[f.key]).map((f) => `${f.label} ${vitals[f.key]}`)
  if (parts.length === 0) {
    return <span className="text-xs text-muted-foreground">No vitals yet</span>
  }
  return <span className="text-xs text-muted-foreground">{parts.join(" · ")}</span>
}
