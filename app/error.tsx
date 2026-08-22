"use client"

import { useEffect } from "react"
import { TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <TriangleAlert className="size-5" aria-hidden />
      </span>
      <h1 className="text-2xl font-heading font-semibold">Something went wrong</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        That&apos;s on us, not something you did. Try again, and if it keeps happening let the clinic know.
      </p>
      <Button onClick={() => reset()} className="mt-1 h-11">
        Try again
      </Button>
    </main>
  )
}
