import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { Role, Sex, QueueStatus, QueuePriority, QueueSource } from "@prisma/client"
import { superuserPrisma } from "@/lib/test/superuser-prisma"
import { prisma } from "@/lib/db/prisma"
import { previewExpiredRecords, purgeExpiredRecords } from "@/lib/retention/purge"
import {
  NOTIFICATION_RETENTION_DAYS,
  CONSULTATION_RETENTION_DAYS,
  PAYMENT_RETENTION_DAYS,
  PATIENT_RETENTION_DAYS,
} from "@/lib/retention/policy"

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

describe("retention purge", () => {
  let branch: { id: string }
  let doctorId: string
  let collectorUserId: string

  // Fixtures whose survival/removal we assert on by name, not just count.
  let patientToPurge: { id: string }
  let patientToKeepRecent: { id: string }
  let patientOldButStillReferenced: { id: string }
  let queueEntryAndConsultationToPurge: { queueEntryId: string; consultationId: string; dispensedId: string }
  let queueEntryToPurgeStandalone: { id: string }
  let paymentToPurge: { id: string }
  let paymentToKeep: { id: string }
  let notificationToPurge: { id: string }
  let notificationToKeep: { id: string }

  beforeAll(async () => {
    const holding = await superuserPrisma.holdingCompany.create({ data: { name: "Retention Test Holding" } })
    const clinicRow = await superuserPrisma.clinic.create({
      data: { holdingCompanyId: holding.id, name: "Retention Test Clinic" },
    })
    const branchRow = await superuserPrisma.branch.create({
      data: {
        clinicId: clinicRow.id,
        name: "Retention Test Branch",
        slug: `retention-test-${Date.now()}`,
        address: "1 Test St",
        city: "Test City",
        phone: "0000",
        operatingHours: {},
      },
    })
    branch = { id: branchRow.id }

    const docUser = await superuserPrisma.user.create({
      data: {
        branchId: branch.id,
        name: "Dr. Retention",
        email: `dr-retention-${Date.now()}@test.local`,
        passwordHash: "x",
        role: Role.DOCTOR,
      },
    })
    const doctor = await superuserPrisma.doctor.create({
      data: { userId: docUser.id, branchId: branch.id, licenseNumber: "R1", consultationFee: 50000 },
    })
    doctorId = doctor.id

    const collector = await superuserPrisma.user.create({
      data: {
        branchId: branch.id,
        name: "Front Desk Retention",
        email: `fd-retention-${Date.now()}@test.local`,
        passwordHash: "x",
        role: Role.FRONT_DESK,
      },
    })
    collectorUserId = collector.id

    async function makePatient(name: string, createdAt: Date) {
      return superuserPrisma.patient.create({
        data: {
          branchId: branch.id,
          firstName: name,
          lastName: "Retention",
          birthdate: new Date("1990-01-01"),
          sex: Sex.FEMALE,
          phone: `+63 917 ${Math.floor(Math.random() * 900000) + 100000}`,
          address: "addr",
          emergencyContactName: "ec",
          emergencyContactPhone: "+63 917 000 0000",
          createdAt,
        },
      })
    }

    patientToPurge = await makePatient("PurgeMe", daysAgo(PATIENT_RETENTION_DAYS + 30))
    patientToKeepRecent = await makePatient("KeepMeRecent", new Date())
    patientOldButStillReferenced = await makePatient("KeepMeReferenced", daysAgo(PATIENT_RETENTION_DAYS + 30))

    async function makeQueueEntry(patientId: string, queueDate: Date, createdAt: Date) {
      return superuserPrisma.queueEntry.create({
        data: {
          branchId: branch.id,
          patientId,
          doctorId,
          queueNumber: Math.floor(Math.random() * 1_000_000) + 1,
          queueDate,
          status: QueueStatus.COMPLETED,
          priority: QueuePriority.NORMAL,
          source: QueueSource.WALK_IN,
          accessToken: `retention-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          createdAt,
        },
      })
    }

    // Old queue entry + old consultation (+ a dispensed medicine row) that
    // should all disappear together in one purge run — this is the case
    // that proves deletion order actually works: the queue entry only
    // becomes eligible once its consultation is gone, and both happen in
    // the same purgeExpiredRecords() call.
    const oldQueueDate = daysAgo(CONSULTATION_RETENTION_DAYS + 30)
    const oldQueueEntry = await makeQueueEntry(patientOldButStillReferenced.id, oldQueueDate, oldQueueDate)
    const oldConsultation = await superuserPrisma.consultation.create({
      data: {
        queueEntryId: oldQueueEntry.id,
        patientId: patientOldButStillReferenced.id,
        doctorId,
        branchId: branch.id,
        chiefComplaint: "Old visit",
        createdAt: oldQueueDate,
      },
    })
    const oldDispensed = await superuserPrisma.medicineDispensed.create({
      data: {
        consultationId: oldConsultation.id,
        branchId: branch.id,
        medicineName: "Old Medicine",
        quantity: 1,
        createdAt: oldQueueDate,
      },
    })
    queueEntryAndConsultationToPurge = {
      queueEntryId: oldQueueEntry.id,
      consultationId: oldConsultation.id,
      dispensedId: oldDispensed.id,
    }

    // A *recent* consultation on patientOldButStillReferenced — this is
    // what keeps that patient alive despite its own createdAt being past
    // PATIENT_RETENTION_DAYS: as long as anything still-retained
    // references it, the patient itself must survive.
    const recentQueueEntry = await makeQueueEntry(patientOldButStillReferenced.id, new Date(), new Date())
    await superuserPrisma.consultation.create({
      data: {
        queueEntryId: recentQueueEntry.id,
        patientId: patientOldButStillReferenced.id,
        doctorId,
        branchId: branch.id,
        chiefComplaint: "Recent visit",
      },
    })

    // A standalone old queue entry with no consultation at all (e.g. a
    // long-ago no-show) — eligible on its own, no ordering dependency.
    const standalone = await makeQueueEntry(patientToKeepRecent.id, daysAgo(CONSULTATION_RETENTION_DAYS + 30), daysAgo(CONSULTATION_RETENTION_DAYS + 30))
    queueEntryToPurgeStandalone = { id: standalone.id }

    async function makePayment(patientId: string, receivedAt: Date) {
      return superuserPrisma.payment.create({
        data: {
          branchId: branch.id,
          patientId,
          amount: 10000,
          collectedByUserId: collectorUserId,
          receivedAt,
        },
      })
    }
    const oldPayment = await makePayment(patientToKeepRecent.id, daysAgo(PAYMENT_RETENTION_DAYS + 30))
    paymentToPurge = { id: oldPayment.id }
    const recentPayment = await makePayment(patientToKeepRecent.id, new Date())
    paymentToKeep = { id: recentPayment.id }

    async function makeNotification(patientId: string, createdAt: Date) {
      return superuserPrisma.notification.create({
        data: {
          branchId: branch.id,
          patientId,
          channel: "SMS",
          templateKey: "test",
          payload: {},
          createdAt,
        },
      })
    }
    const oldNotification = await makeNotification(patientToKeepRecent.id, daysAgo(NOTIFICATION_RETENTION_DAYS + 5))
    notificationToPurge = { id: oldNotification.id }
    const recentNotification = await makeNotification(patientToKeepRecent.id, new Date())
    notificationToKeep = { id: recentNotification.id }
  })

  afterAll(async () => {
    await superuserPrisma.auditLog.deleteMany({ where: { branchId: branch.id } })
    await superuserPrisma.notification.deleteMany({ where: { branchId: branch.id } })
    await superuserPrisma.payment.deleteMany({ where: { branchId: branch.id } })
    await superuserPrisma.medicineDispensed.deleteMany({ where: { branchId: branch.id } })
    await superuserPrisma.consultation.deleteMany({ where: { branchId: branch.id } })
    await superuserPrisma.queueEntry.deleteMany({ where: { branchId: branch.id } })
    await superuserPrisma.patient.deleteMany({ where: { branchId: branch.id } })
    await superuserPrisma.doctor.deleteMany({ where: { branchId: branch.id } })
    await superuserPrisma.user.deleteMany({ where: { branchId: branch.id } })
    const { clinicId } = await superuserPrisma.branch.findUniqueOrThrow({ where: { id: branch.id }, select: { clinicId: true } })
    await superuserPrisma.branch.deleteMany({ where: { id: branch.id } })
    await superuserPrisma.clinic.delete({ where: { id: clinicId } })
    await superuserPrisma.$disconnect()
    await prisma.$disconnect()
  })

  it("previews the correct counts without deleting anything", async () => {
    const before = await previewExpiredRecords(superuserPrisma)
    expect(before.patients).toBeGreaterThanOrEqual(1) // patientToPurge
    expect(before.consultations).toBeGreaterThanOrEqual(1)
    expect(before.medicinesDispensed).toBeGreaterThanOrEqual(1)
    expect(before.queueEntries).toBeGreaterThanOrEqual(2) // the paired one + the standalone one
    expect(before.payments).toBeGreaterThanOrEqual(1)
    expect(before.notifications).toBeGreaterThanOrEqual(1)

    // Nothing actually removed by a preview.
    const stillThere = await superuserPrisma.patient.findUnique({ where: { id: patientToPurge.id } })
    expect(stillThere).not.toBeNull()
  })

  it("purges exactly the expired rows, in FK-safe order, and keeps everything else", async () => {
    const counts = await purgeExpiredRecords(superuserPrisma)
    expect(counts.patients).toBeGreaterThanOrEqual(1)
    expect(counts.consultations).toBeGreaterThanOrEqual(1)
    expect(counts.medicinesDispensed).toBeGreaterThanOrEqual(1)
    expect(counts.queueEntries).toBeGreaterThanOrEqual(2)
    expect(counts.payments).toBeGreaterThanOrEqual(1)
    expect(counts.notifications).toBeGreaterThanOrEqual(1)

    // Purged.
    expect(await superuserPrisma.patient.findUnique({ where: { id: patientToPurge.id } })).toBeNull()
    expect(
      await superuserPrisma.consultation.findUnique({ where: { id: queueEntryAndConsultationToPurge.consultationId } })
    ).toBeNull()
    expect(
      await superuserPrisma.medicineDispensed.findUnique({ where: { id: queueEntryAndConsultationToPurge.dispensedId } })
    ).toBeNull()
    expect(
      await superuserPrisma.queueEntry.findUnique({ where: { id: queueEntryAndConsultationToPurge.queueEntryId } })
    ).toBeNull()
    expect(await superuserPrisma.queueEntry.findUnique({ where: { id: queueEntryToPurgeStandalone.id } })).toBeNull()
    expect(await superuserPrisma.payment.findUnique({ where: { id: paymentToPurge.id } })).toBeNull()
    expect(await superuserPrisma.notification.findUnique({ where: { id: notificationToPurge.id } })).toBeNull()

    // Kept: recent rows, and the old patient that's still referenced by a
    // recent consultation.
    expect(await superuserPrisma.patient.findUnique({ where: { id: patientToKeepRecent.id } })).not.toBeNull()
    expect(await superuserPrisma.patient.findUnique({ where: { id: patientOldButStillReferenced.id } })).not.toBeNull()
    expect(await superuserPrisma.payment.findUnique({ where: { id: paymentToKeep.id } })).not.toBeNull()
    expect(await superuserPrisma.notification.findUnique({ where: { id: notificationToKeep.id } })).not.toBeNull()

    const log = await superuserPrisma.auditLog.findFirst({
      where: { action: "retention.purge" },
      orderBy: { createdAt: "desc" },
    })
    expect(log).toBeTruthy()
    expect(log?.entityType).toBe("System")
  })

  it("is idempotent — running the purge again doesn't error on already-gone rows", async () => {
    await expect(purgeExpiredRecords(superuserPrisma)).resolves.toBeDefined()
    expect(await superuserPrisma.patient.findUnique({ where: { id: patientToPurge.id } })).toBeNull()
    expect(
      await superuserPrisma.consultation.findUnique({ where: { id: queueEntryAndConsultationToPurge.consultationId } })
    ).toBeNull()
  })
})
