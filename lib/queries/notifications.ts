import type { Prisma, NotificationChannel as ChannelEnum } from "@prisma/client"
import { runWithRls } from "@/lib/db/rls"
import { requireBranchId, type AbilitySubject } from "@/lib/permissions/ability"
import { ForbiddenError } from "@/lib/permissions/errors"
import { getNotificationChannel } from "@/lib/notifications/channel"
import { renderTemplate, type TemplateKey, type TemplatePayloads } from "@/lib/notifications/templates"
import { branchTimezone, todayAsQueueDate } from "@/lib/queries/queue"

/**
 * Renders the template, sends through whichever channel driver
 * NOTIFICATION_CHANNEL selects, and writes a `notifications` row
 * regardless of outcome (§7.6: "Every send writes a notifications row
 * regardless of channel or outcome"). A send failure is caught and
 * recorded as a FAILED row rather than thrown — a notification going out
 * must never roll back the booking/call/no-show it's attached to.
 */
export async function sendNotification<K extends TemplateKey>(
  tx: Prisma.TransactionClient,
  params: {
    branchId: string
    patientId: string
    queueEntryId?: string
    to: string
    channel: ChannelEnum
    templateKey: K
    payload: TemplatePayloads[K]
  }
): Promise<void> {
  const message = renderTemplate(params.templateKey, params.payload)
  const driver = getNotificationChannel()

  let result: Awaited<ReturnType<typeof driver.send>>
  try {
    result = await driver.send(params.to, message)
  } catch (err) {
    result = { status: "failed", error: err instanceof Error ? err.message : String(err) }
  }

  await tx.notification.create({
    data: {
      branchId: params.branchId,
      patientId: params.patientId,
      queueEntryId: params.queueEntryId ?? null,
      channel: params.channel,
      templateKey: params.templateKey,
      // The fully rendered text lives here (`renderedMessage`) alongside
      // the raw template data — §12/M5's accept line checks for exactly
      // this: "each write a notification row with fully rendered message
      // text," not just the template key and variables.
      payload: { ...params.payload, renderedMessage: message, to: params.to },
      status: result.status === "sent" ? "SENT" : result.status === "failed" ? "FAILED" : "MOCKED",
      providerMessageId: result.status === "sent" ? result.providerMessageId : null,
      error: result.status === "failed" ? result.error : null,
      sentAt: result.status !== "failed" ? new Date() : null,
    },
  })
}

export type NotificationLogEntry = {
  id: string
  patientName: string
  channel: string
  templateKey: string
  status: string
  renderedMessage: string
  error: string | null
  createdAt: Date
}

/** M5's "notification log viewer" — every send attempt, mocked or otherwise, newest first. */
export async function listNotifications(user: AbilitySubject, opts: { limit?: number } = {}): Promise<NotificationLogEntry[]> {
  const branchId = requireBranchId(user)
  return runWithRls(user, async (tx) => {
    const notifications = await tx.notification.findMany({
      where: { branchId },
      include: { patient: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: "desc" },
      take: opts.limit ?? 50,
    })
    return notifications.map((n) => ({
      id: n.id,
      patientName: `${n.patient.lastName}, ${n.patient.firstName}`,
      channel: n.channel,
      templateKey: n.templateKey,
      status: n.status,
      renderedMessage: (n.payload as { renderedMessage?: string })?.renderedMessage ?? "",
      error: n.error,
      createdAt: n.createdAt,
    }))
  })
}

export type FollowUpDue = {
  consultationId: string
  patientId: string
  patientName: string
  doctorName: string
  followUpDate: Date
  isOverdue: boolean
  alreadySent: boolean
}

/** §9 Staff screen "follow-up list" — consultations with a due-or-overdue follow-up date. */
export async function listDueFollowUps(user: AbilitySubject): Promise<FollowUpDue[]> {
  const branchId = requireBranchId(user)
  return runWithRls(user, async (tx) => {
    // followUpDate is a `@db.Date` column, so "today" must be built the
    // same UTC-midnight-as-calendar-label way todayAsQueueDate builds
    // queueDate — not `new Date(new Date().toDateString())`, which
    // reinterprets the local calendar date as a real local-midnight
    // instant. Those two "midnights" only coincide when the server's own
    // timezone happens to match the branch's, and even then are 0-23h
    // apart depending on the server's UTC offset — so a same-day
    // follow-up could silently fail to show as due for hours after local
    // midnight. Same bug class as M4's payment instant-range fix.
    const timezone = await branchTimezone(tx, branchId)
    const today = todayAsQueueDate(timezone)
    const consultations = await tx.consultation.findMany({
      where: { branchId, deletedAt: null, followUpDate: { not: null, lte: today } },
      include: {
        patient: { select: { firstName: true, lastName: true } },
        doctor: { include: { user: { select: { name: true } } } },
      },
      orderBy: { followUpDate: "asc" },
    })

    const consultationIds = consultations.map((c) => c.id)
    const sentReminders = consultationIds.length
      ? await tx.notification.findMany({
          where: { branchId, templateKey: "follow_up_due", queueEntryId: { in: consultations.map((c) => c.queueEntryId) } },
          select: { queueEntryId: true },
        })
      : []
    const sentQueueEntryIds = new Set(sentReminders.map((n) => n.queueEntryId))

    return consultations.map((c) => ({
      consultationId: c.id,
      patientId: c.patientId,
      patientName: `${c.patient.lastName}, ${c.patient.firstName}`,
      doctorName: c.doctor.user.name,
      followUpDate: c.followUpDate!,
      isOverdue: c.followUpDate!.getTime() < today.getTime(),
      alreadySent: sentQueueEntryIds.has(c.queueEntryId),
    }))
  })
}

/** One-tap send from the follow-up list — can be sent again even if already sent once (a patient may need a nudge). */
export async function sendFollowUpReminder(user: AbilitySubject, consultationId: string): Promise<void> {
  const branchId = requireBranchId(user)
  await runWithRls(user, async (tx) => {
    const consultation = await tx.consultation.findFirst({
      where: { id: consultationId, branchId, deletedAt: null },
      include: {
        patient: true,
        doctor: { include: { user: { select: { name: true } } } },
        branch: { select: { name: true } },
      },
    })
    if (!consultation || !consultation.followUpDate) {
      throw new ForbiddenError("Consultation not found in your branch, or has no follow-up date")
    }

    await sendNotification(tx, {
      branchId,
      patientId: consultation.patientId,
      queueEntryId: consultation.queueEntryId,
      to: consultation.patient.phone,
      channel: "SMS",
      templateKey: "follow_up_due",
      payload: {
        patientName: consultation.patient.firstName,
        clinicName: consultation.branch.name,
        doctorName: consultation.doctor.user.name,
        followUpDate: consultation.followUpDate.toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" }),
      },
    })
    await tx.auditLog.create({
      data: { branchId, userId: user.id, action: "notification.follow_up_reminder", entityType: "Consultation", entityId: consultationId },
    })
  })
}
