import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { listTodayQueue } from "@/lib/queries/queue"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { NowServingScreen } from "./now-serving-screen"

/**
 * The calling board — a single "now serving" panel meant for a screen in the
 * waiting room, showing the number and the patient's name, announcing the
 * name aloud, and flashing when it changes.
 *
 * DELIBERATELY NOT AT /display/{slug}, AND DELIBERATELY BEHIND A LOGIN.
 * That route is public and §10 forbids it from ever carrying a patient
 * name — getPublicDisplayState returns queue numbers only, not even a
 * patientId. This page shows names, so it cannot be public: a passer-by with
 * the URL would otherwise get a live roster of who is at the clinic today,
 * which is exactly the disclosure that rule exists to prevent.
 *
 * It sits outside /staff so it renders full-bleed with no app chrome, which
 * is what a wall display wants. proxy.ts still requires a session for it —
 * only the three section prefixes carry extra role rules — so the screen has
 * to be signed in once when it is set up. That sign-in is the access control.
 */
export default async function NowServingPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  // A holding admin has no branch, so there is no single queue to show them.
  // listTodayQueue would throw a plain Error here, which renders as a 500
  // rather than an explanation.
  if (session.user.role === "HOLDING_ADMIN" || !session.user.branchId) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-sidebar p-8 text-center text-sidebar-foreground">
        <h1 className="font-heading text-3xl font-semibold">Now serving</h1>
        <p className="max-w-md text-sidebar-foreground/70">
          This board shows one branch&rsquo;s queue. Sign in on the screen with an account attached to the branch it
          is standing in.
        </p>
      </main>
    )
  }

  const user: AbilitySubject = {
    id: session.user.id,
    role: session.user.role,
    branchId: session.user.branchId,
    holdingCompanyId: session.user.holdingCompanyId,
  }

  const entries = await listTodayQueue(user)

  // Same rule the staff board uses: the most recently called entry that is
  // still with a doctor or waiting to be seen.
  const serving = entries
    .filter((e) => e.status === "CALLED" || e.status === "IN_CONSULTATION")
    .sort((a, b) => (b.calledAt?.getTime() ?? 0) - (a.calledAt?.getTime() ?? 0))[0]

  const upNext = entries
    .filter((e) => e.status === "CHECKED_IN" || e.status === "WAITING")
    .sort((a, b) => a.queueNumber - b.queueNumber)
    .slice(0, 3)
    .map((e) => e.queueNumber)

  return (
    <NowServingScreen
      nowServing={serving ? { queueNumber: serving.queueNumber, name: serving.patientName } : null}
      upNext={upNext}
    />
  )
}
