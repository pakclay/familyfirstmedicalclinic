"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-heading font-semibold">Something went wrong</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        That&apos;s on us, not something you did. Try again, and if it keeps happening let the clinic know.
      </p>
      <Button onClick={() => reset()} className="h-11">
        Try again
      </Button>
    </main>
  )
}
