"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import type { StaffQueueEntryDTO } from "@/lib/queries/queue"
import { startConsultationAction } from "@/lib/actions/queue"

const POLL_MS = 7000

const STATUS_LABEL: Record<string, string> = {
  WAITING: "Waiting",
  CALLED: "Called",
  IN_CONSULTATION: "In consultation",
}

export function DoctorQueueList({ initialEntries }: { initialEntries: StaffQueueEntryDTO[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const id = setInterval(() => router.refresh(), POLL_MS)
    return () => clearInterval(id)
  }, [router])

  function handleStart(id: string) {
    setError(null)
    startTransition(async () => {
      try {
        await startConsultationAction(id)
        router.push(`/doctor/consultation/${id}`)
      } catch {
        setError("Couldn't start the consultation — try again.")
      }
    })
  }

  return (
    <div>
      {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
      <ul className="divide-y divide-border rounded-md border border-border">
        {initialEntries.map((e) => (
          <li key={e.id} className="flex items-center justify-between gap-2 px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="font-numeric w-8 text-lg font-semibold">{e.queueNumber}</span>
              <div>
                <p className="text-sm">
                  {e.patientName}
                  {e.priority === "PRIORITY" && (
                    <Badge variant="outline" className="ml-2 border-priority text-priority">
                      Priority
                    </Badge>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {e.patientAge}y · {e.reasonForVisit} · {STATUS_LABEL[e.status] ?? e.status}
                </p>
              </div>
            </div>
            {e.status === "CALLED" && (
              <Button size="sm" disabled={pending} onClick={() => handleStart(e.id)}>
                Start consultation
              </Button>
            )}
            {e.status === "IN_CONSULTATION" && (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => router.push(`/doctor/consultation/${e.id}`)}>
                Continue
              </Button>
            )}
          </li>
        ))}
        {initialEntries.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">Nobody assigned to you yet today.</li>
        )}
      </ul>
    </div>
  )
}
