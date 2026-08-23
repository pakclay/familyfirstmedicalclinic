"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { setUserActiveAction, unlockAccountAction, forcePasswordResetAction } from "../actions"

export function UserDetailActions({
  userId,
  isActive,
  isLockedOut,
  isSelf,
}: {
  userId: string
  isActive: boolean
  isLockedOut: boolean
  isSelf: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function run(action: () => Promise<{ ok: boolean; error?: string }>, successMessage: string) {
    setError(null)
    setMessage(null)
    startTransition(async () => {
      const result = await action()
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.")
        return
      }
      setMessage(successMessage)
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium uppercase text-muted-foreground">Account actions</p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => run(() => forcePasswordResetAction(userId), "They'll be asked to set a new password next sign-in.")}
        >
          Force password reset
        </Button>
        {isLockedOut && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => run(() => unlockAccountAction(userId), "Account unlocked.")}
          >
            Unlock account
          </Button>
        )}
        {!isSelf && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => run(() => setUserActiveAction(userId, !isActive), isActive ? "Deactivated." : "Reactivated.")}
          >
            {isActive ? "Deactivate" : "Reactivate"}
          </Button>
        )}
      </div>
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
