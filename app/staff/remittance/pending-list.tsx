"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import type { PendingRemittance } from "@/lib/queries/remittance"
import { confirmRemittanceAction } from "./actions"

export function PendingRemittanceList({ items }: { items: PendingRemittance[] }) {
  const router = useRouter()
  const [pendingId, setPendingId] = useState<string | null>(null)

  async function handleConfirm(id: string) {
    setPendingId(id)
    await confirmRemittanceAction(id)
    setPendingId(null)
    router.refresh()
  }

  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {items.map((r) => (
        <li key={r.id} className="flex items-center justify-between gap-2 px-4 py-3 text-sm">
          <div>
            <p>{r.collectorName}</p>
            <p className="text-xs text-muted-foreground">
              Expected ₱{(r.expectedAmount / 100).toFixed(2)} · Handed over ₱{(r.actualAmount / 100).toFixed(2)} ·{" "}
              <span className={r.variance === 0 ? "" : r.variance > 0 ? "text-brand" : "text-destructive"}>
                {r.variance > 0 ? "+" : ""}
                ₱{(r.variance / 100).toFixed(2)} variance
              </span>
            </p>
            {r.notes && <p className="text-xs text-muted-foreground">&ldquo;{r.notes}&rdquo;</p>}
          </div>
          <Button size="sm" disabled={pendingId === r.id} onClick={() => handleConfirm(r.id)}>
            Confirm
          </Button>
        </li>
      ))}
      {items.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing pending confirmation.</li>}
    </ul>
  )
}
