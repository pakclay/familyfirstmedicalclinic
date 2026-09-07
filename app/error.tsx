"use client"

import { TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * The last-resort boundary for the whole app — there is no other `error.tsx`
 * in the tree, so every uncaught server or client error lands here.
 *
 * Two things it deliberately does NOT do. It does not print `error.message`:
 * for an error forwarded from a Server Component React replaces that with a
 * generic string anyway (error.md, "error.message"), and where it isn't
 * replaced the message is written for us, not for a patient standing at a
 * front desk — the same rule lib/db/errors.ts applies to server actions. And
 * it does not apologise for something the user did wrong, because reaching
 * this boundary always means the server failed to render.
 *
 * `retry`, not `reset`. They are different functions and only one of them
 * can fix a server error: `reset` clears the boundary's client state and
 * re-renders the same already-failed payload, while `retry` re-fetches from
 * the server. This page shipped with `reset`, so its "Try again" button was
 * decorative — the card simply reappeared. The version's own docs say it
 * plainly: "In most cases, you should use retry() instead."
 */
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <TriangleAlert className="size-5" aria-hidden />
      </span>
      <h1 className="text-2xl font-heading font-semibold">Something went wrong</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        That&apos;s on us, not something you did. Try again, and if it keeps happening let the clinic know.
      </p>
      <Button onClick={() => retry()} className="mt-1 h-11">
        Try again
      </Button>
      {/* The one identifier that ties this screen to the server log
          (instrumentation.ts prints the same digest). Small and last,
          because it is for the person being asked "what did it say?", not
          for the person trying to get on with their day. */}
      {error.digest && (
        <p className="mt-2 font-numeric text-xs text-muted-foreground">
          Reference <span className="select-all">{error.digest}</span>
        </p>
      )}
    </main>
  )
}
