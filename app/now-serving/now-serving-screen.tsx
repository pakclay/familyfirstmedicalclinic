"use client"

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { useRouter } from "next/navigation"
import { Volume2, VolumeX } from "lucide-react"

// §7.3 DECISION: poll every 5–10s, not WebSockets. Matches the public display.
const POLL_MS = 7000

export type NowServing = { queueNumber: number; name: string } | null

/**
 * Whether this browser can speak at all, read hydration-safely: the server
 * has no `speechSynthesis`, so it must render the same `false` the client
 * starts from. Nothing to subscribe to — the answer cannot change for the
 * life of the page.
 */
const noopSubscribe = () => () => {}
const speechOnClient = () => "speechSynthesis" in window
const speechOnServer = () => false

/**
 * Queue rows carry the patient name as "Lastname, Firstname" so lists sort
 * correctly. Read aloud that way it comes out backwards, and on a wall it
 * reads like a form field rather than a person being called.
 */
function spokenName(name: string): string {
  const [last, first] = name.split(",", 2)
  return first ? `${first.trim()} ${last.trim()}` : name.trim()
}

export function NowServingScreen({ nowServing, upNext }: { nowServing: NowServing; upNext: number[] }) {
  const router = useRouter()
  const canSpeak = useSyncExternalStore(noopSubscribe, speechOnClient, speechOnServer)

  /**
   * Starts off every time the page loads, and deliberately is not remembered.
   * Browsers refuse to speak until the page has had a real user gesture, so a
   * restored "on" could not actually announce anything until someone clicked
   * regardless — persisting it would only promise sound the screen cannot
   * make. One click when the display is set up is the honest version.
   */
  const [announce, setAnnounce] = useState(false)
  const [flashing, setFlashing] = useState(false)

  // What was on screen last render. Starts undefined rather than null so the
  // first paint is not treated as a new call — otherwise the board announces
  // whoever happened to be with a doctor the moment it was switched on.
  const lastCalled = useRef<number | null | undefined>(undefined)

  useEffect(() => {
    const id = setInterval(() => router.refresh(), POLL_MS)
    return () => clearInterval(id)
  }, [router])

  const speak = useCallback((queueNumber: number, name: string) => {
    if (!("speechSynthesis" in window)) return
    // Cancel anything still queued: two calls in quick succession should
    // announce the current patient, not read a backlog to an empty room.
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(`Number ${queueNumber}. ${spokenName(name)}.`)
    utterance.rate = 0.85
    window.speechSynthesis.speak(utterance)
  }, [])

  // Fires only on an actual change of number, not on every poll.
  useEffect(() => {
    const current = nowServing?.queueNumber ?? null
    const previous = lastCalled.current
    lastCalled.current = current

    if (previous === undefined || current === null || current === previous) return

    setFlashing(true)
    const id = window.setTimeout(() => setFlashing(false), 3000)
    if (announce && nowServing) speak(nowServing.queueNumber, nowServing.name)
    return () => window.clearTimeout(id)
  }, [nowServing, announce, speak])

  function toggleAnnounce() {
    const next = !announce
    setAnnounce(next)
    // Speaking inside the click satisfies the browser's requirement that
    // audio start from a gesture, and doubles as a check that whoever set the
    // screen up can hear it — a silent display that believes it is announcing
    // is the failure worth catching here, not later.
    if (next && nowServing) speak(nowServing.queueNumber, nowServing.name)
  }

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-8 bg-sidebar p-8 text-sidebar-foreground">
      {canSpeak && (
        <button
          type="button"
          onClick={toggleAnnounce}
          aria-pressed={announce}
          className="absolute right-6 top-6 inline-flex items-center gap-2 rounded-md border border-sidebar-border px-4 py-2.5 text-base text-sidebar-foreground/80 transition-colors hover:text-sidebar-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        >
          {announce ? <Volume2 className="size-5" /> : <VolumeX className="size-5" />}
          {announce ? "Announcing" : "Announce names"}
        </button>
      )}

      <p className="text-3xl tracking-wide text-sidebar-foreground/60">Now serving</p>

      <div className={`flex flex-col items-center gap-4 ${flashing ? "animate-call-flash" : ""}`}>
        {/* No placeholder glyph when the queue is idle. An em-dash set at this
            size renders as a solid bar the width of the screen, which reads as
            a broken image rather than as "nobody yet" — the wording below says
            it better than a character can. */}
        {nowServing && (
          <p className="font-numeric text-[clamp(7rem,26vw,18rem)] font-bold leading-none text-signal">
            {nowServing.queueNumber}
          </p>
        )}
        <p
          className={
            nowServing
              ? "max-w-[18ch] text-balance text-center font-heading text-[clamp(2rem,7vw,4.5rem)] font-semibold leading-tight"
              : "text-balance text-center font-heading text-[clamp(2rem,6vw,3.5rem)] font-semibold leading-tight text-sidebar-foreground/50"
          }
        >
          {nowServing ? spokenName(nowServing.name) : "Nobody is being called right now"}
        </p>
      </div>

      {upNext.length > 0 && (
        <div className="flex flex-col items-center gap-3">
          <p className="text-xl text-sidebar-foreground/60">Next</p>
          <div className="flex gap-8">
            {upNext.map((n) => (
              <span key={n} className="font-numeric text-5xl font-semibold text-sidebar-foreground/80">
                {n}
              </span>
            ))}
          </div>
        </div>
      )}
    </main>
  )
}
