"use server"

import { headers } from "next/headers"
import { createPublicBooking, BranchNotFoundError } from "@/lib/queries/booking"
import type { PatientDTO } from "@/lib/dto/patient"
import type { QueueEntryDTO } from "@/lib/dto/queue-entry"
import { clientIpFromHeaders } from "@/lib/rate-limit/key"
import { blockedMessage, consumeRateLimit } from "@/lib/rate-limit/limiter"
import { BOOKING_RATE_LIMIT } from "@/lib/rate-limit/policy"

export type BookingResult = { patient: PatientDTO; queueEntry: QueueEntryDTO; clinicName: string; accessToken: string }

export async function createBookingAction(
  branchSlug: string,
  input: Record<string, unknown>
): Promise<{ ok: true; result: BookingResult } | { ok: false; error: string }> {
  // Per-SOURCE throttle, checked before any validation and before any
  // write — a blocked caller creates no patient row, no queue entry and no
  // notification. Enforced here rather than in proxy.ts for the reason in
  // that file's header comment (it is deliberately Prisma-free).
  //
  // The key is scoped to the booking surface only, NOT to `branchSlug`:
  // including the slug would let one source multiply its budget by the
  // number of branches just by changing the URL. See
  // lib/rate-limit/key.ts's `rateLimitKey`.
  const ip = clientIpFromHeaders(await headers())
  const decision = await consumeRateLimit(BOOKING_RATE_LIMIT, ip)
  const blocked = blockedMessage(BOOKING_RATE_LIMIT, decision)
  if (blocked) return { ok: false, error: blocked }

  try {
    const result = await createPublicBooking(branchSlug, input)
    return { ok: true, result }
  } catch (err) {
    if (err instanceof BranchNotFoundError) {
      return { ok: false, error: "This clinic isn't available for booking right now." }
    }
    if (err && typeof err === "object" && "issues" in err) {
      const zodErr = err as { issues: { message: string }[] }
      return { ok: false, error: zodErr.issues[0]?.message ?? "Check the form for errors." }
    }
    return { ok: false, error: "Something went wrong. Please try again." }
  }
}
