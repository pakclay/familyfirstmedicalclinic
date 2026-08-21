"use server"

import { createPublicBooking, ClinicNotFoundError } from "@/lib/queries/booking"
import type { PatientDTO } from "@/lib/dto/patient"
import type { QueueEntryDTO } from "@/lib/dto/queue-entry"

export type BookingResult = { patient: PatientDTO; queueEntry: QueueEntryDTO; clinicName: string; accessToken: string }

export async function createBookingAction(
  clinicSlug: string,
  input: Record<string, unknown>
): Promise<{ ok: true; result: BookingResult } | { ok: false; error: string }> {
  try {
    const result = await createPublicBooking(clinicSlug, input)
    return { ok: true, result }
  } catch (err) {
    if (err instanceof ClinicNotFoundError) {
      return { ok: false, error: "This clinic isn't available for booking right now." }
    }
    if (err && typeof err === "object" && "issues" in err) {
      const zodErr = err as { issues: { message: string }[] }
      return { ok: false, error: zodErr.issues[0]?.message ?? "Check the form for errors." }
    }
    return { ok: false, error: "Something went wrong. Please try again." }
  }
}
