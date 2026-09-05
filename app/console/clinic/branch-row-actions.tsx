"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { setOwnClinicBranchActiveAction } from "./actions"

/**
 * The clinic admin's copy of app/console/clinics/[id]/branch-row-actions.tsx.
 * Not shared: the two call different server actions with different gates,
 * and this one has no clinic id to pass — the action derives it from the
 * session (see ./actions.ts). Duplicating a dozen lines keeps the two
 * authorization paths from sharing anything that could be loosened together.
 */
export function BranchRowActions({ branchId, isActive }: { branchId: string; isActive: boolean }) {
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
        onClick={() => run(() => setOwnClinicBranchActiveAction(branchId, !isActive))}
      >
        {isActive ? "Deactivate" : "Reactivate"}
      </Button>
    </div>
  )
}
