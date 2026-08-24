import { prisma } from "@/lib/db/prisma"
import { runWithBranchScope } from "@/lib/db/rls"
import { toPatientDTO, type PatientDTO } from "@/lib/dto/patient"
import { toQueueEntryDTO, type QueueEntryDTO } from "@/lib/dto/queue-entry"
import { bookingIntakeSchema } from "@/lib/validation/patient"
import { nextQueueNumber, todayAsQueueDate, tomorrowAsQueueDate } from "@/lib/queries/queue"
import { generateAccessToken } from "@/lib/utils/token"
import { sendNotification } from "@/lib/queries/notifications"
import { publicBranchName } from "@/lib/queries/public-branch-name"

export class BranchNotFoundError extends Error {}

/**
 * §7.1 public booking. No authenticated user — `branches` carries no RLS
 * (same M1-era decision as `clinics` before it: RLS covers patient/queue/
 * money tables, not the directory tables), so resolving the slug needs no
 * special scoping, but every Patient/QueueEntry write after that runs
 * under `runWithBranchScope` (§5: branch_id derived from the resolved
 * branch, never a client-supplied id — the slug only ever selects *which*
 * branch, the write itself is still RLS-checked against that branch).
 *
 * The `clinicName`/`clinicAddress` fields below are patient-facing copy,
 * not code identifiers — a patient booking a visit calls the physical
 * location "the clinic" regardless of the internal Clinic/Branch org
 * chart, so this keeps that wording even though the data now comes from
 * Branch. See DECISIONS.md.
 */
export async function createPublicBooking(
  branchSlug: string,
  input: unknown
): Promise<{ patient: PatientDTO; queueEntry: QueueEntryDTO; clinicName: string; accessToken: string }> {
  const branch = await prisma.branch.findUnique({
    where: { slug: branchSlug, isActive: true },
    include: { clinic: { select: { name: true } } },
  })
  if (!branch) throw new BranchNotFoundError(`No active branch at slug "${branchSlug}"`)

  const parsed = bookingIntakeSchema.parse(input)
  const digits = parsed.phone.replace(/\D/g, "").slice(-10)

  return runWithBranchScope(branch.id, async (tx) => {
    const queueDate =
      parsed.preferredDate === "today" ? todayAsQueueDate(branch.timezone) : tomorrowAsQueueDate(branch.timezone)

    // §7.1: "match to an existing patient by phone + last name +
    // birthdate. If matched, attach to that record; if not, create a new
    // patient." Phone comparison is format-invariant for the same reason
    // as the staff-side duplicate search (lib/queries/patients.ts) — a raw
    // DB `contains`/`equals` would miss a stored number whose punctuation
    // doesn't line up with the caller's formatting.
    const candidates = await tx.patient.findMany({
      where: { branchId: branch.id, deletedAt: null, lastName: { equals: parsed.lastName, mode: "insensitive" } },
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
            branchId: branch.id,
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

    const queueNumber = await nextQueueNumber(tx, branch.id, queueDate)
    const queueEntry = await tx.queueEntry.create({
      data: {
        branchId: branch.id,
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
        data: { branchId: branch.id, userId: null, action: "patient.create", entityType: "Patient", entityId: patient.id },
      })
    }
    await tx.auditLog.create({
      data: {
        branchId: branch.id,
        userId: null,
        action: "queue_entry.create",
        entityType: "QueueEntry",
        entityId: queueEntry.id,
        changes: { source: "FACEBOOK", patientId: patient.id, matched: !!match },
      },
    })

    // §7.6: "Booking confirmed" — queue number + status link + clinic
    // address, sent by SMS (§7.6 DECISION: SMS is the primary channel,
    // reaching every patient regardless of whether they messaged on
    // Facebook — Messenger can't be the sole channel for this).
    const statusUrl = `${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/q/${queueEntry.accessToken}`
    await sendNotification(tx, {
      branchId: branch.id,
      patientId: patient.id,
      queueEntryId: queueEntry.id,
      to: patient.phone,
      channel: "SMS",
      templateKey: "booking_confirmed",
      payload: {
        patientName: patient.firstName,
        clinicName: publicBranchName(branch),
        clinicAddress: branch.address,
        queueNumber: queueEntry.queueNumber,
        statusUrl,
      },
    })

    return {
      patient: toPatientDTO(patient),
      queueEntry: toQueueEntryDTO(queueEntry),
      clinicName: publicBranchName(branch),
      // The one legitimate place this ever leaves the server: straight
      // back to the patient who just created this exact booking, so they
      // can reach their own status page (§7.1 step 5). QueueEntryDTO
      // deliberately omits it everywhere else (staff board, doctor queue,
      // patient profile history) — see lib/dto/queue-entry.ts.
      accessToken: queueEntry.accessToken,
    }
  })
}
