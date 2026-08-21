import { prisma } from "@/lib/db/prisma"
import { runWithClinicScope } from "@/lib/db/rls"
import { toPatientDTO, type PatientDTO } from "@/lib/dto/patient"
import { toQueueEntryDTO, type QueueEntryDTO } from "@/lib/dto/queue-entry"
import { bookingIntakeSchema } from "@/lib/validation/patient"
import { nextQueueNumber, todayAsQueueDate, tomorrowAsQueueDate } from "@/lib/queries/queue"
import { generateAccessToken } from "@/lib/utils/token"

export class ClinicNotFoundError extends Error {}

/**
 * §7.1 public booking. No authenticated user — `clinics` carries no RLS
 * (M1 decision: RLS covers patient/queue/money tables, not the directory
 * tables), so resolving the slug needs no special scoping, but every
 * Patient/QueueEntry write after that runs under `runWithClinicScope`
 * (§5: clinic_id derived from the resolved clinic, never a client-supplied
 * id — the slug only ever selects *which* clinic, the write itself is
 * still RLS-checked against that clinic).
 */
export async function createPublicBooking(
  clinicSlug: string,
  input: unknown
): Promise<{ patient: PatientDTO; queueEntry: QueueEntryDTO; clinicName: string; accessToken: string }> {
  const clinic = await prisma.clinic.findUnique({ where: { slug: clinicSlug, isActive: true } })
  if (!clinic) throw new ClinicNotFoundError(`No active clinic at slug "${clinicSlug}"`)

  const parsed = bookingIntakeSchema.parse(input)
  const digits = parsed.phone.replace(/\D/g, "").slice(-10)

  return runWithClinicScope(clinic.id, async (tx) => {
    const queueDate =
      parsed.preferredDate === "today" ? todayAsQueueDate(clinic.timezone) : tomorrowAsQueueDate(clinic.timezone)

    // §7.1: "match to an existing patient by phone + last name +
    // birthdate. If matched, attach to that record; if not, create a new
    // patient." Phone comparison is format-invariant for the same reason
    // as the staff-side duplicate search (lib/queries/patients.ts) — a raw
    // DB `contains`/`equals` would miss a stored number whose punctuation
    // doesn't line up with the caller's formatting.
    const candidates = await tx.patient.findMany({
      where: { clinicId: clinic.id, deletedAt: null, lastName: { equals: parsed.lastName, mode: "insensitive" } },
    })
    const match = candidates.find(
      (p) =>
        p.phone.replace(/\D/g, "").slice(-10) === digits &&
        p.birthdate.getTime() === parsed.birthdate.getTime()
    )

    const patient = match
      ? match
      : await tx.patient.create({
          data: {
            clinicId: clinic.id,
            firstName: parsed.firstName,
            lastName: parsed.lastName,
            middleName: parsed.middleName || null,
            birthdate: parsed.birthdate,
            sex: parsed.sex,
            phone: parsed.phone,
            email: parsed.email || null,
            address: parsed.address,
            emergencyContactName: parsed.emergencyContactName,
            emergencyContactPhone: parsed.emergencyContactPhone,
            guardianName: parsed.guardianName || null,
            guardianPhone: parsed.guardianPhone || null,
            consentAt: new Date(),
          },
        })

    const queueNumber = await nextQueueNumber(tx, clinic.id, queueDate)
    const queueEntry = await tx.queueEntry.create({
      data: {
        clinicId: clinic.id,
        patientId: patient.id,
        queueNumber,
        queueDate,
        status: "BOOKED",
        priority: parsed.priority ? "PRIORITY" : "NORMAL",
        source: "FACEBOOK",
        reasonForVisit: parsed.reasonForVisit,
        accessToken: generateAccessToken(),
      },
    })

    if (!match) {
      await tx.auditLog.create({
        data: { clinicId: clinic.id, userId: null, action: "patient.create", entityType: "Patient", entityId: patient.id },
      })
    }
    await tx.auditLog.create({
      data: {
        clinicId: clinic.id,
        userId: null,
        action: "queue_entry.create",
        entityType: "QueueEntry",
        entityId: queueEntry.id,
        changes: { source: "FACEBOOK", patientId: patient.id, matched: !!match },
      },
    })

    return {
      patient: toPatientDTO(patient),
      queueEntry: toQueueEntryDTO(queueEntry),
      clinicName: clinic.name,
      // The one legitimate place this ever leaves the server: straight
      // back to the patient who just created this exact booking, so they
      // can reach their own status page (§7.1 step 5). QueueEntryDTO
      // deliberately omits it everywhere else (staff board, doctor queue,
      // patient profile history) — see lib/dto/queue-entry.ts.
      accessToken: queueEntry.accessToken,
    }
  })
}
