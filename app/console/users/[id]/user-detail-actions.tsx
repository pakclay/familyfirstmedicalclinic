"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import {
  setUserActiveAction,
  unlockAccountAction,
  forcePasswordResetAction,
  regenerateTempPasswordAction,
} from "../actions"

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
  // Held in component state and never re-fetched: the server returns the
  // plaintext once and keeps only the hash, so navigating away loses it for
  // good — the same contract the create-user screen has.
  const [issuedPassword, setIssuedPassword] = useState<string | null>(null)

  function run(action: () => Promise<{ ok: boolean; error?: string }>, successMessage: string) {
    setError(null)
    setMessage(null)
    setIssuedPassword(null)
    startTransition(async () => {
      const result = await action()
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.")
        return
      }
      setMessage(successMessage)
    })
  }

  function issueNewPassword() {
    setError(null)
    setMessage(null)
    setIssuedPassword(null)
    startTransition(async () => {
      const result = await regenerateTempPasswordAction(userId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setIssuedPassword(result.tempPassword)
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
        {/* Hidden for the actor's own account, matching Deactivate — the
            server refuses it either way, so offering the button would only
            promise something it will not do. */}
        {!isSelf && (
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={issueNewPassword}>
            Issue new password
          </Button>
        )}
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
      {issuedPassword && (
        <div className="rounded-md border border-border px-3 py-3">
          <p className="text-sm text-muted-foreground">
            New temporary password — share it with them now. It can&rsquo;t be shown again once you leave this page.
          </p>
          <p className="mt-2 rounded-md border border-border bg-muted px-3 py-2 font-mono text-base">
            {issuedPassword}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Their old password no longer works, any lockout is cleared, and they&rsquo;ll be asked to set their own
            password the first time they sign in.
          </p>
        </div>
      )}
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
