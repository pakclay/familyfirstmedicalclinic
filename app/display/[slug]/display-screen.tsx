"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import type { PublicDisplayState } from "@/lib/queries/public-queue"

// §7.3 DECISION: poll every 5–10s, not WebSockets.
const POLL_MS = 7000

export function DisplayScreen({ initialState }: { slug: string; initialState: PublicDisplayState }) {
  const router = useRouter()

  useEffect(() => {
    const id = setInterval(() => router.refresh(), POLL_MS)
    return () => clearInterval(id)
  }, [router])

  const state = initialState

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-10 bg-sidebar p-8 text-sidebar-foreground">
      <h1 className="font-heading text-2xl font-semibold tracking-wide text-sidebar-foreground/70">
        {state.clinicName}
      </h1>

      <div className="flex flex-col items-center gap-2">
        <p className="text-2xl text-sidebar-foreground/70">Now serving</p>
        <p className="font-numeric text-[14rem] leading-none font-bold text-signal">
          {state.nowServing ?? "—"}
        </p>
      </div>

      {state.next.length > 0 && (
        <div className="flex flex-col items-center gap-3">
          <p className="text-xl text-sidebar-foreground/70">Next</p>
          <div className="flex gap-6">
            {state.next.map((n) => (
              <span key={n} className="font-numeric text-5xl font-semibold text-sidebar-foreground/90">
                {n}
              </span>
            ))}
          </div>
        </div>
      )}
    </main>
  )
}
