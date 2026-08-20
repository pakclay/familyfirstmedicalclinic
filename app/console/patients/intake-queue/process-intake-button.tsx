"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { processIntakeSubmission } from "@/lib/actions/intake"
import { Button } from "@/components/ui/button"

export function ProcessIntakeButton({ submissionId }: { submissionId: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handle() {
    setError(null)
    startTransition(async () => {
      try {
        const patient = await processIntakeSubmission(submissionId)
        router.push(`/console/patients/${patient.id}`)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not process this submission.")
      }
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" onClick={handle} disabled={isPending}>
        {isPending ? "Processing…" : "Process"}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
