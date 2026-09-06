import type { Prisma, PrismaClient } from "@prisma/client"
import {
  NOTIFICATION_RETENTION_DAYS,
  CONSULTATION_RETENTION_DAYS,
  PAYMENT_RETENTION_DAYS,
  PATIENT_RETENTION_DAYS,
  RATE_LIMIT_RETENTION_DAYS,
} from "./policy"

export type RetentionCounts = {
  notifications: number
  medicinesDispensed: number
  consultations: number
  payments: number
  queueEntries: number
  patients: number
  rateLimits: number
}

function daysAgo(days: number, now: Date): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
}

type ExpiredIds = {
  notificationIds: string[]
  consultationIds: string[]
  medicineDispensedIds: string[]
  paymentIds: string[]
  queueEntryIds: string[]
  patientIds: string[]
  /** `rate_limits` is keyed by its string key, not a uuid id. */
  rateLimitKeys: string[]
}

/**
 * The one place that decides what's expired — shared by the read-only
 * preview and the real purge below, so "what would be deleted" and "what
 * actually gets deleted" can never drift apart.
 *
 * Computed as explicit id lists, not a single declarative query per
 * table, because eligibility cascades: a queue entry only becomes
 * eligible once every consultation that references it is *also* expired
 * (an old queue entry with a recent consultation must survive), and a
 * patient only becomes eligible once every queue entry/consultation/
 * payment/notification referencing it is *also* already in one of these
 * lists. `consultations: { none: { id: { notIn: consultationIds } } }`
 * reads as "no consultation exists that isn't already in our to-delete
 * set" — i.e. every consultation left standing (if any) is one we're
 * about to remove anyway. An empty `notIn` array matches everything, so
 * this still works correctly when nothing's expired in the table above.
 */
async function computeExpiredIds(prisma: Prisma.TransactionClient, now: Date): Promise<ExpiredIds> {
  const notificationCutoff = daysAgo(NOTIFICATION_RETENTION_DAYS, now)
  const consultationCutoff = daysAgo(CONSULTATION_RETENTION_DAYS, now)
  const paymentCutoff = daysAgo(PAYMENT_RETENTION_DAYS, now)
  const patientCutoff = daysAgo(PATIENT_RETENTION_DAYS, now)

  const notificationIds = (
    await prisma.notification.findMany({ where: { createdAt: { lt: notificationCutoff } }, select: { id: true } })
  ).map((r) => r.id)

  const consultationIds = (
    await prisma.consultation.findMany({ where: { createdAt: { lt: consultationCutoff } }, select: { id: true } })
  ).map((r) => r.id)

  const medicineDispensedIds = (
    await prisma.medicineDispensed.findMany({
      where: { consultationId: { in: consultationIds } },
      select: { id: true },
    })
  ).map((r) => r.id)

  const paymentIds = (
    await prisma.payment.findMany({ where: { receivedAt: { lt: paymentCutoff } }, select: { id: true } })
  ).map((r) => r.id)

  const queueEntryIds = (
    await prisma.queueEntry.findMany({
      where: {
        queueDate: { lt: consultationCutoff },
        consultations: { none: { id: { notIn: consultationIds } } },
      },
      select: { id: true },
    })
  ).map((r) => r.id)

  const patientIds = (
    await prisma.patient.findMany({
      where: {
        createdAt: { lt: patientCutoff },
        queueEntries: { none: { id: { notIn: queueEntryIds } } },
        consultations: { none: { id: { notIn: consultationIds } } },
        payments: { none: { id: { notIn: paymentIds } } },
        notifications: { none: { id: { notIn: notificationIds } } },
      },
      select: { id: true },
    })
  ).map((r) => r.id)

  // Per-IP rate-limit counters (lib/rate-limit/). Nothing references these
  // rows and they reference nothing, so unlike everything above there is
  // no cascade to resolve — the only question is whether a row is still
  // live. Selected by `updatedAt`, which moves on every hit, rather than
  // `windowStart`, which does not move while a source is blocked: keying
  // off the window start would delete the row of the one caller actively
  // being throttled and hand them a fresh budget, which is precisely
  // backwards. With the longest window at 15 minutes and the cutoff a day
  // wide, a row this old cannot still be limiting anybody.
  const rateLimitCutoff = daysAgo(RATE_LIMIT_RETENTION_DAYS, now)
  const rateLimitKeys = (
    await prisma.rateLimit.findMany({ where: { updatedAt: { lt: rateLimitCutoff } }, select: { key: true } })
  ).map((r) => r.key)

  return {
    notificationIds,
    consultationIds,
    medicineDispensedIds,
    paymentIds,
    queueEntryIds,
    patientIds,
    rateLimitKeys,
  }
}

function toCounts(ids: ExpiredIds): RetentionCounts {
  return {
    notifications: ids.notificationIds.length,
    medicinesDispensed: ids.medicineDispensedIds.length,
    consultations: ids.consultationIds.length,
    payments: ids.paymentIds.length,
    queueEntries: ids.queueEntryIds.length,
    patients: ids.patientIds.length,
    rateLimits: ids.rateLimitKeys.length,
  }
}

/**
 * Read-only — counts what `purgeExpiredRecords` would delete, without
 * deleting anything. Safe to run against any connection with SELECT
 * (including the app's normal APP_DATABASE_URL role, unlike the purge
 * itself), and is `prisma/retention.ts`'s default mode.
 */
export async function previewExpiredRecords(
  prisma: PrismaClient,
  now: Date = new Date()
): Promise<RetentionCounts> {
  return toCounts(await computeExpiredIds(prisma, now))
}

/**
 * Actually deletes everything past its retention window (see policy.ts),
 * in one transaction — either the whole purge lands or none of it does.
 * Deletes by the exact id lists `computeExpiredIds` already resolved
 * (same ids preview would have reported), in the order the schema's FK
 * constraints require — leaves before parents:
 * medicinesDispensed → consultations → payments → notifications →
 * queueEntries → patients, then the FK-free rateLimits rows.
 *
 * Requires a connection with DELETE (the app's runtime `webinar_app` role
 * deliberately has none — see prisma/grant-app-role.sql — so this can
 * only ever run through prisma/retention.ts's superuser connection, never
 * from inside the running app).
 */
export async function purgeExpiredRecords(prisma: PrismaClient, now: Date = new Date()): Promise<RetentionCounts> {
  return prisma.$transaction(async (tx) => {
    const ids = await computeExpiredIds(tx, now)

    await tx.medicineDispensed.deleteMany({ where: { id: { in: ids.medicineDispensedIds } } })
    await tx.consultation.deleteMany({ where: { id: { in: ids.consultationIds } } })
    await tx.payment.deleteMany({ where: { id: { in: ids.paymentIds } } })
    await tx.notification.deleteMany({ where: { id: { in: ids.notificationIds } } })
    await tx.queueEntry.deleteMany({ where: { id: { in: ids.queueEntryIds } } })
    await tx.patient.deleteMany({ where: { id: { in: ids.patientIds } } })
    // Last, and order-independent: `rate_limits` has no foreign keys in
    // either direction. It is here at all because the app role has no
    // DELETE grant, so this superuser job is the only thing that can prune
    // it — see the model comment in prisma/schema.prisma.
    await tx.rateLimit.deleteMany({ where: { key: { in: ids.rateLimitKeys } } })

    const counts = toCounts(ids)

    await tx.auditLog.create({
      data: {
        action: "retention.purge",
        entityType: "System",
        changes: counts,
      },
    })

    return counts
  })
}
