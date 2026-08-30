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

  const audioRef = useRef<AudioContext | null>(null)
  const speakTimer = useRef<number | null>(null)

  /**
   * The attention chime, synthesised rather than played from a file.
   *
   * A two-note fall is the sound a waiting room already understands, and
   * generating it costs no asset to host, no network request on a screen that
   * may be on flaky clinic wifi, and nothing to license. Two sine tones with a
   * soft attack and an exponential tail — the ramps matter, because a gain
   * that jumps straight to full volume clicks audibly on cheap TV speakers.
   *
   * Returns how long to wait before speaking, so the voice lands after the
   * chime rather than under it.
   */
  const chime = useCallback((): number => {
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return 0

    const ctx = audioRef.current ?? (audioRef.current = new Ctor())
    // Created suspended until the page has had a gesture; the toggle is that
    // gesture, so this resumes on the first announcement and is a no-op after.
    if (ctx.state === "suspended") void ctx.resume()

    const start = ctx.currentTime
    // A5 then E5 — a falling fourth, which reads as "attention" rather than
    // as an alarm. Deliberately not a rising pair, which sounds like a
    // question.
    for (const [frequency, offset] of [
      [880, 0],
      [659.25, 0.26],
    ] as const) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      const at = start + offset

      osc.type = "sine"
      osc.frequency.value = frequency
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(0.22, at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.42)

      osc.connect(gain).connect(ctx.destination)
      osc.start(at)
      osc.stop(at + 0.45)
    }

    return 620
  }, [])

  const speak = useCallback((queueNumber: number, name: string) => {
    if (!("speechSynthesis" in window)) return
    // Cancel anything still queued: two calls in quick succession should
    // announce the current patient, not read a backlog to an empty room.
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(`Number ${queueNumber}. ${spokenName(name)}.`)
    utterance.rate = 0.85
    window.speechSynthesis.speak(utterance)
  }, [])

  /** Chime, then the name — the sound is what makes people look up in time to hear it. */
  const announceCall = useCallback(
    (queueNumber: number, name: string) => {
      if (speakTimer.current !== null) window.clearTimeout(speakTimer.current)
      const delay = chime()
      speakTimer.current = window.setTimeout(() => speak(queueNumber, name), delay)
    },
    [chime, speak]
  )

  // A board left running for a day should not leak an audio context or fire a
  // pending announcement into a page that has gone.
  useEffect(() => {
    return () => {
      if (speakTimer.current !== null) window.clearTimeout(speakTimer.current)
      void audioRef.current?.close()
      audioRef.current = null
    }
  }, [])

  // Fires only on an actual change of number, not on every poll.
  useEffect(() => {
    const current = nowServing?.queueNumber ?? null
    const previous = lastCalled.current
    lastCalled.current = current

    if (previous === undefined || current === null || current === previous) return

    setFlashing(true)
    const id = window.setTimeout(() => setFlashing(false), 3000)
    if (announce && nowServing) announceCall(nowServing.queueNumber, nowServing.name)
    return () => window.clearTimeout(id)
  }, [nowServing, announce, announceCall])

  function toggleAnnounce() {
    const next = !announce
    setAnnounce(next)
    // Sounding inside the click satisfies the browser's requirement that audio
    // start from a gesture — for the AudioContext as much as for speech — and
    // doubles as a check that whoever set the screen up can hear it. A silent
    // display that believes it is announcing is the failure worth catching
    // here, not later.
    if (next && nowServing) announceCall(nowServing.queueNumber, nowServing.name)
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
