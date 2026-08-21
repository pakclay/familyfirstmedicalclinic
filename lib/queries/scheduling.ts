import { Prisma, type AppointmentSource } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { runWithRls } from "@/lib/db/rls"
import { ForbiddenError } from "@/lib/permissions/errors"
import { scopeWhere } from "@/lib/permissions/scoped-queries"
import { canAccess, type AbilitySubject } from "@/lib/permissions/ability"
import { computeAvailableSlots, hasConflict, type Interval, type WeeklyAvailabilityWindow } from "@/lib/scheduling/availability"

const APPOINTMENT_SCOPE_FIELDS = { branchField: "branchId", ownField: "therapistId" } as const
const ACTIVE_STATUSES = ["BOOKED", "CONFIRMED", "CHECKED_IN", "COMPLETED"] as const

function requireReadScope(user: AbilitySubject) {
  const where = scopeWhere(user, "appointments", "read", APPOINTMENT_SCOPE_FIELDS)
  if (!where) throw new ForbiddenError("Your role cannot view the schedule")
  return where
}

function requireWriteScope(user: AbilitySubject) {
  const where = scopeWhere(user, "appointments", "write", APPOINTMENT_SCOPE_FIELDS)
  if (!where) throw new ForbiddenError("Your role cannot manage appointments")
  return where
}

/** THERAPIST write scope is "own" (§4.1) — every mutation below must check
 * this consistently, not just the ones that happened to remember to. */
function assertCanMutateAppointment(user: AbilitySubject, appt: { branchId: string; therapistId: string }) {
  if (user.role === "OWNER") return
  if (user.role === "THERAPIST") {
    if (appt.therapistId !== user.id) throw new ForbiddenError("You can only manage your own appointments")
    return
  }
  if (user.homeBranchId !== appt.branchId) throw new ForbiddenError("Cannot manage an appointment at another branch")
}

export async function listAppointmentsFor(
  user: AbilitySubject,
  query: { branchId: string; therapistId?: string; dayStart: Date; dayEnd: Date }
) {
  const scope = requireReadScope(user)
  const and: Prisma.AppointmentWhereInput[] = [
    scope,
    { branchId: query.branchId, deletedAt: null, startsAt: { gte: query.dayStart, lt: query.dayEnd } },
  ]
  if (query.therapistId) and.push({ therapistId: query.therapistId })

  return runWithRls(user, (tx) =>
    tx.appointment.findMany({
      where: { AND: and },
      orderBy: { startsAt: "asc" },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, patientCode: true } },
        service: { select: { id: true, name: true, category: true, durationMin: true } },
        room: { select: { id: true, name: true } },
      },
    })
  )
}

/**
 * Dropdown/context data for the booking form. Deliberately excludes
 * `priceCentavos` — THERAPIST has `appointments` write:own (they can book
 * their own slots) but must never receive a money field, per §4.2's hard
 * rule. Booking itself only needs name/duration; price is a checkout
 * concern, gated separately by getServicePriceForCheckoutFor() below.
 */
export async function getBookingContextFor(user: AbilitySubject, branchId: string) {
  const scope = scopeWhere(user, "appointments", "write", APPOINTMENT_SCOPE_FIELDS)
  if (!scope) throw new ForbiddenError("Your role cannot book appointments")
  if (user.role !== "OWNER" && user.homeBranchId !== branchId) {
    throw new ForbiddenError("Cannot book for another branch")
  }

  const [therapists, services, rooms] = await Promise.all([
    prisma.user.findMany({
      where: { role: "THERAPIST", homeBranchId: branchId, isActive: true, deletedAt: null },
      select: { id: true, name: true, therapistProfile: { select: { specialties: true } } },
    }),
    prisma.service.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, category: true, durationMin: true, requiresPrescription: true },
    }),
    prisma.room.findMany({ where: { branchId, isActive: true }, orderBy: { name: "asc" } }),
  ])

  return { therapists, services, rooms }
}

/** Gated on `payments` write access — this is the one place a service's
 * price is allowed to reach the client, for the front-desk/owner checkout
 * flow only. */
export async function getServicePriceForCheckoutFor(user: AbilitySubject, serviceId: string) {
  if (!canAccess(user, "payments", "write")) throw new ForbiddenError("Your role cannot record payments")
  const service = await prisma.service.findUniqueOrThrow({
    where: { id: serviceId },
    select: { id: true, name: true, priceCentavos: true },
  })
  return service
}

export async function getAvailableSlotsFor(
  user: AbilitySubject,
  params: { therapistId: string; branchId: string; serviceId: string; date: Date }
) {
  const scope = scopeWhere(user, "appointments", "write", APPOINTMENT_SCOPE_FIELDS)
  if (!scope) throw new ForbiddenError("Your role cannot book appointments")

  const service = await prisma.service.findUniqueOrThrow({ where: { id: params.serviceId } })

  const dayStart = new Date(params.date)
  dayStart.setUTCHours(0, 0, 0, 0)
  const dayEnd = new Date(dayStart.getTime() + 26 * 60 * 60 * 1000) // generous UTC-day padding around the Manila civil day

  const [availabilityRows, timeOffRows, busyRows] = await Promise.all([
    prisma.therapistAvailability.findMany({
      where: {
        therapistId: params.therapistId,
        branchId: params.branchId,
        deletedAt: null,
        effectiveFrom: { lte: params.date },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: params.date } }],
      },
    }),
    prisma.timeOff.findMany({
      where: { therapistId: params.therapistId, deletedAt: null, startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } },
    }),
    prisma.appointment.findMany({
      where: {
        therapistId: params.therapistId,
        deletedAt: null,
        status: { in: [...ACTIVE_STATUSES] },
        startsAt: { lt: dayEnd },
        endsAt: { gt: dayStart },
      },
      select: { startsAt: true, endsAt: true },
    }),
  ])

  const weeklyAvailability: WeeklyAvailabilityWindow[] = availabilityRows.map((r) => ({
    dayOfWeek: r.dayOfWeek,
    startTime: r.startTime,
    endTime: r.endTime,
  }))
  const timeOff: Interval[] = timeOffRows.map((t) => ({ start: t.startsAt, end: t.endsAt }))
  const busy: Interval[] = busyRows.map((b) => ({ start: b.startsAt, end: b.endsAt }))

  return computeAvailableSlots({
    date: params.date,
    weeklyAvailability,
    timeOff,
    busy,
    serviceDurationMin: service.durationMin,
  })
}

export type CreateAppointmentInput = {
  patientId: string
  branchId: string
  therapistId: string
  serviceId: string
  roomId?: string
  startsAt: Date
  source: AppointmentSource
  patientPackageId?: string
  notes?: string
}

export async function createAppointmentFor(user: AbilitySubject, input: CreateAppointmentInput) {
  requireWriteScope(user)
  if (user.role !== "OWNER" && user.homeBranchId !== input.branchId) {
    throw new ForbiddenError("Cannot book for another branch")
  }

  const service = await prisma.service.findUniqueOrThrow({ where: { id: input.serviceId } })
  const endsAt = new Date(input.startsAt.getTime() + service.durationMin * 60 * 1000)

  return runWithRls(user, async (tx) => {
    // Transactional re-check (§9) — the slots shown to the operator could be
    // stale by the time they submit; this is the guard that actually matters.
    const conflicts = await tx.appointment.findMany({
      where: {
        deletedAt: null,
        status: { in: [...ACTIVE_STATUSES] },
        startsAt: { lt: endsAt },
        endsAt: { gt: input.startsAt },
        OR: [{ therapistId: input.therapistId }, ...(input.roomId ? [{ roomId: input.roomId }] : [])],
      },
      select: { startsAt: true, endsAt: true, therapistId: true, roomId: true },
    })
    const toInterval = (c: { startsAt: Date; endsAt: Date }): Interval => ({ start: c.startsAt, end: c.endsAt })
    const therapistBusy = conflicts.filter((c) => c.therapistId === input.therapistId).map(toInterval)
    if (hasConflict({ start: input.startsAt, end: endsAt }, therapistBusy)) {
      throw new Error("This therapist was just booked for that time — pick another slot.")
    }
    if (input.roomId) {
      const roomBusy = conflicts.filter((c) => c.roomId === input.roomId).map(toInterval)
      if (hasConflict({ start: input.startsAt, end: endsAt }, roomBusy)) {
        throw new Error("That room was just booked for that time — pick another slot or room.")
      }
    }

    return tx.appointment.create({
      data: {
        patientId: input.patientId,
        branchId: input.branchId,
        therapistId: input.therapistId,
        serviceId: input.serviceId,
        roomId: input.roomId,
        startsAt: input.startsAt,
        endsAt,
        source: input.source,
        patientPackageId: input.patientPackageId,
        notes: input.notes,
        createdById: user.id,
      },
    })
  })
}

export async function checkInAppointmentFor(user: AbilitySubject, appointmentId: string) {
  requireWriteScope(user)
  return runWithRls(user, async (tx) => {
    const appt = await tx.appointment.findUniqueOrThrow({ where: { id: appointmentId } })
    assertCanMutateAppointment(user, appt)
    if (!["BOOKED", "CONFIRMED"].includes(appt.status)) {
      throw new Error(`Cannot check in an appointment that is ${appt.status}`)
    }
    return tx.appointment.update({ where: { id: appointmentId }, data: { status: "CHECKED_IN", checkedInAt: new Date() } })
  })
}

export async function markNoShowFor(user: AbilitySubject, appointmentId: string, noShowFeeCentavos?: number) {
  requireWriteScope(user)
  return runWithRls(user, async (tx) => {
    const appt = await tx.appointment.findUniqueOrThrow({ where: { id: appointmentId } })
    assertCanMutateAppointment(user, appt)
    if (!["BOOKED", "CONFIRMED"].includes(appt.status)) {
      throw new Error(`Cannot mark a ${appt.status} appointment as no-show`)
    }
    return tx.appointment.update({
      where: { id: appointmentId },
      data: { status: "NO_SHOW", noShowFee: noShowFeeCentavos ?? null },
    })
  })
}

export async function cancelAppointmentFor(user: AbilitySubject, appointmentId: string, reason: string) {
  requireWriteScope(user)
  if (!reason.trim()) throw new Error("A cancellation reason is required")
  return runWithRls(user, async (tx) => {
    const appt = await tx.appointment.findUniqueOrThrow({ where: { id: appointmentId } })
    assertCanMutateAppointment(user, appt)
    if (["COMPLETED", "CANCELLED", "NO_SHOW"].includes(appt.status)) {
      throw new Error(`Cannot cancel an appointment that is already ${appt.status}`)
    }
    return tx.appointment.update({
      where: { id: appointmentId },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason },
    })
  })
}

export type CompleteAppointmentResult = { appointment: { id: string; status: string } }

export type SoapNoteFields = {
  subjective: string
  objective: string
  assessment: string
  plan: string
  painBefore?: number
  painAfter?: number
  modalitiesPerformed: string[]
}

/**
 * §6's prescription gate + §6's "completing an appointment consumes one
 * credit from the linked PatientPackage in the same transaction," both
 * enforced here since this is the one place an appointment becomes
 * COMPLETED.
 *
 * The SOAP note is optional here, deliberately — the ability matrix gives
 * OWNER/BRANCH_MANAGER/FRONT_DESK no write access to soapNotes at all
 * (they can complete an appointment administratively, but can't
 * clinically document one), and §7.1's quota `countingRules.
 * requireSignedSessionNote` is where "no note, no credit" actually gets
 * enforced (Phase 5), not here. When a THERAPIST/DOCTOR does provide one,
 * it's created already-signed (§5: "immutable once signed") in the same
 * transaction as completion.
 */
export async function completeAppointmentFor(
  user: AbilitySubject,
  appointmentId: string,
  opts: { overrideReason?: string; soapNote?: SoapNoteFields } = {}
): Promise<CompleteAppointmentResult> {
  requireWriteScope(user)

  return runWithRls(user, async (tx) => {
    const appt = await tx.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
      include: { service: true, patient: { select: { id: true, status: true } } },
    })
    assertCanMutateAppointment(user, appt)
    if (appt.status !== "CHECKED_IN") {
      throw new Error(`Cannot complete an appointment that is ${appt.status} — check the patient in first`)
    }

    if (appt.service.requiresPrescription) {
      const validPrescription = await tx.prescription.findFirst({
        where: {
          patientId: appt.patientId,
          status: "SIGNED",
          validFrom: { lte: appt.startsAt },
          validUntil: { gte: appt.startsAt },
          deletedAt: null,
        },
      })

      if (!validPrescription) {
        const canOverride = user.role === "OWNER" && opts.overrideReason?.trim()
        if (!canOverride) {
          throw new Error(
            "This service requires a signed, valid prescription on file before it can be completed. Only the owner can override this, with a written reason."
          )
        }
        await tx.auditLog.create({
          data: {
            actorId: user.id,
            action: "COMPLETE_APPOINTMENT_PRESCRIPTION_OVERRIDE",
            entityType: "Appointment",
            entityId: appt.id,
            after: { reason: opts.overrideReason },
          },
        })
      }
    }

    if (appt.patientPackageId) {
      const pkg = await tx.patientPackage.findUniqueOrThrow({ where: { id: appt.patientPackageId } })
      if (pkg.status !== "ACTIVE") {
        throw new Error(`This patient's package is ${pkg.status.toLowerCase()}, not active — cannot consume a credit`)
      }
      const sessionsUsed = pkg.sessionsUsed + 1
      await tx.patientPackage.update({
        where: { id: pkg.id },
        data: {
          sessionsUsed,
          status: sessionsUsed >= pkg.sessionsTotal ? "CONSUMED" : "ACTIVE",
        },
      })
    }

    // DOCTOR has appointments write:none (checked by requireWriteScope
    // above, so a DOCTOR never reaches this line at all) — only THERAPIST
    // can complete an appointment and also hold soapNotes write access.
    if (opts.soapNote && user.role === "THERAPIST") {
      await tx.sessionNote.create({
        data: {
          appointmentId: appt.id,
          patientId: appt.patientId,
          therapistId: appt.therapistId,
          subjective: opts.soapNote.subjective,
          objective: opts.soapNote.objective,
          assessment: opts.soapNote.assessment,
          plan: opts.soapNote.plan,
          painBefore: opts.soapNote.painBefore,
          painAfter: opts.soapNote.painAfter,
          modalitiesPerformed: opts.soapNote.modalitiesPerformed,
          durationMin: appt.service.durationMin,
          signedAt: new Date(),
          createdById: user.id,
        },
      })
    }

    const updated = await tx.appointment.update({
      where: { id: appointmentId },
      data: { status: "COMPLETED", completedAt: new Date() },
    })

    // lastVisitAt is a system-computed side effect of completing a session,
    // not a demographic edit — but the Patient ability matrix gives
    // THERAPIST no write access at all (write:none on patientDemographics),
    // and RLS enforces that literally. We've already verified above that
    // this user is allowed to complete *this appointment* (own/branch
    // scope on the appointments resource), so re-present as OWNER for just
    // this one already-gated statement rather than leaving the field stale.
    // Scoped to this transaction only via SET LOCAL — never touches any
    // other write in this file.
    await tx.$executeRaw`SELECT set_config('app.role', 'OWNER', true)`
    await tx.patient.update({ where: { id: appt.patientId }, data: { lastVisitAt: updated.completedAt } })

    return { appointment: { id: updated.id, status: updated.status } }
  })
}
