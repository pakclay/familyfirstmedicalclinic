"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { setUserActiveAction, unlockAccountAction } from "./actions"

export function UserRowActions({
  userId,
  isActive,
  isLockedOut,
}: {
  userId: string
  isActive: boolean
  isLockedOut: boolean
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
      {isLockedOut && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => run(() => unlockAccountAction(userId))}
        >
          Unlock
        </Button>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => run(() => setUserActiveAction(userId, !isActive))}
      >
        {isActive ? "Deactivate" : "Reactivate"}
      </Button>
    </div>
  )
}
