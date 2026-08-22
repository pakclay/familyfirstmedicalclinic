"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import type { FollowUpDue } from "@/lib/queries/notifications"
import { sendFollowUpReminderAction } from "./actions"

export function FollowUpList({ items }: { items: FollowUpDue[] }) {
  const router = useRouter()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleSend(consultationId: string) {
    setPendingId(consultationId)
    setError(null)
    const res = await sendFollowUpReminderAction(consultationId)
    setPendingId(null)
    if (!res.ok) {
      setError(res.error)
      return
    }
    router.refresh()
  }

  return (
    <div>
      {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
      <ul className="divide-y divide-border rounded-md border border-border">
        {items.map((item) => (
          <li key={item.consultationId} className="flex items-center justify-between gap-2 px-4 py-3 text-sm">
            <div>
              <p>
                {item.patientName}
                {item.isOverdue && (
                  <Badge variant="outline" className="ml-2 border-priority text-priority">
                    Overdue
                  </Badge>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {item.doctorName} · Follow-up:{" "}
                {item.followUpDate.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" })}
              </p>
            </div>
            <Button
              size="sm"
              variant={item.alreadySent ? "outline" : "default"}
              disabled={pendingId === item.consultationId}
              onClick={() => handleSend(item.consultationId)}
            >
              {item.alreadySent ? "Send again" : "Send reminder"}
            </Button>
          </li>
        ))}
        {items.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">No follow-ups due.</li>
        )}
      </ul>
    </div>
  )
}
