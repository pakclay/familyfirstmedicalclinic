"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import type { PatientStatus } from "@/lib/queries/public-queue"

// §7.3 DECISION: poll every 5–10s, not WebSockets.
const POLL_MS = 7000

const STATUS_MESSAGE: Record<string, string> = {
  BOOKED: "Your booking is confirmed. Come by the clinic and check in when you arrive.",
  CHECKED_IN: "You're checked in and waiting to be called.",
  WAITING: "You're in line, waiting to be called.",
  CALLED: "You're being called now — please proceed to the clinic.",
  IN_CONSULTATION: "You're currently with the doctor.",
  COMPLETED: "Your visit is complete. Thank you!",
  NO_SHOW: "We missed you. Please call or visit the clinic to rebook.",
  CANCELLED: "This booking was cancelled.",
}

export function StatusScreen({ initialStatus }: { initialStatus: PatientStatus }) {
  const router = useRouter()

  useEffect(() => {
    const id = setInterval(() => router.refresh(), POLL_MS)
    return () => clearInterval(id)
  }, [router])

  const status = initialStatus
  const isWaiting = status.status === "CHECKED_IN" || status.status === "WAITING"

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted p-4">
      <Card className="w-full max-w-sm">
        <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">{status.clinicName}</p>
          <p className="text-sm text-muted-foreground">Your number</p>
          <p className="font-numeric text-7xl font-bold text-brand">{status.queueNumber}</p>

          {isWaiting ? (
            <>
              <p className="text-sm text-muted-foreground">Now serving: {status.nowServing ?? "—"}</p>
              <p className="text-sm">
                {status.patientsAhead} patient{status.patientsAhead === 1 ? "" : "s"} ahead of you
              </p>
              <p className="text-xs text-muted-foreground">
                Estimated wait: ~{status.estimatedWaitMinutes} min
              </p>
            </>
          ) : null}

          <p className="mt-2 text-sm">{STATUS_MESSAGE[status.status] ?? status.status}</p>
          <p className="text-xs text-muted-foreground">{status.clinicAddress}</p>
        </CardContent>
      </Card>
    </main>
  )
}
