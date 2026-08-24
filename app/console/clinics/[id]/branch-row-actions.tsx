"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { setBranchActiveAction } from "../actions"

export function BranchRowActions({
  clinicId,
  branchId,
  isActive,
}: {
  clinicId: string
  branchId: string
  isActive: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null)
    startTransition(async () => {
      const result = await action()
      if (!result.ok) setError(result.error ?? "Something went wrong.")
    })
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      {error && <span className="text-xs text-destructive">{error}</span>}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => run(() => setBranchActiveAction(clinicId, branchId, !isActive))}
      >
        {isActive ? "Deactivate" : "Reactivate"}
      </Button>
    </div>
  )
}
