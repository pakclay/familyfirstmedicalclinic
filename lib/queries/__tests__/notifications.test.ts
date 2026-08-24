import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { Role, Sex } from "@prisma/client"
import { superuserPrisma } from "@/lib/test/superuser-prisma"
import { prisma } from "@/lib/db/prisma"
import { callNextEntry, markNoShow, todayAsQueueDate } from "@/lib/queries/queue"
import { createPublicBooking } from "@/lib/queries/booking"
import { listNotifications, listDueFollowUps, sendFollowUpReminder } from "@/lib/queries/notifications"
import { saveConsultation } from "@/lib/queries/consultations"
import type { AbilitySubject } from "@/lib/permissions/ability"

/**
 * M5's accept bar (§12): "booking, almost-your-turn, and now-serving
 * events each write a notification row with fully rendered message
 * text." Also covers the no-show trigger and the follow-up list's
 * one-tap send, since both reuse the same `sendNotification` core.
 */
describe("notifications", () => {
  let branch: { id: string; slug: string; timezone: string; name: string }
  let frontDesk: AbilitySubject
  let doctorUser: AbilitySubject
  let doctorId: string

  async function createPatient(overrides: { firstName?: string; lastName?: string; phone?: string } = {}) {
    return superuserPrisma.patient.create({
      data: {
        branchId: branch.id,
        firstName: overrides.firstName ?? "Test",
        lastName: overrides.lastName ?? `Patient${Math.random().toString(36).slice(2, 8)}`,
        birthdate: new Date("1990-01-01"),
        sex: Sex.FEMALE,
        phone: overrides.phone ?? `+63 917 ${Math.floor(1000000 + Math.random() * 8999999)}`,
        address: "addr",
        emergencyContactName: "ec",
        emergencyContactPhone: "+63 917 000 0000",
      },
    })
  }

  let entryCounter = 0
  async function createActiveEntry(patientId: string, opts: { checkedInAt?: Date } = {}) {
    entryCounter += 1
    return superuserPrisma.queueEntry.create({
      data: {
        branchId: branch.id,
        patientId,
        queueNumber: 2000 + entryCounter,
        queueDate: todayAsQueueDate(branch.timezone),
        status: "CHECKED_IN",
        source: "WALK_IN",
        checkedInAt: opts.checkedInAt ?? new Date(),
        accessToken: `test-notif-${entryCounter}-${Date.now()}`,
      },
    })
  }

  beforeAll(async () => {
    const holding = await superuserPrisma.holdingCompany.create({ data: { name: "Notification Test Holding" } })
    const clinicRow = await superuserPrisma.clinic.create({
      data: { holdingCompanyId: holding.id, name: "Notification Test Clinic" },
    })
    const branchRow = await superuserPrisma.branch.create({
      data: {
        clinicId: clinicRow.id,
        name: "Notification Test Branch",
        slug: `notif-test-${Date.now()}`,
        address: "1 Test St",
        city: "Test City",
        phone: "+63 900 000 0000",
        timezone: "Asia/Manila",
        operatingHours: {},
      },
    })
    branch = { id: branchRow.id, slug: branchRow.slug, timezone: branchRow.timezone, name: branchRow.name }

    const fdUser = await superuserPrisma.user.create({
      data: { branchId: branch.id, name: "Front Desk", email: `fd-notif-${Date.now()}@test.local`, passwordHash: "x", role: Role.FRONT_DESK },
    })
    frontDesk = { id: fdUser.id, role: Role.FRONT_DESK, branchId: branch.id, holdingCompanyId: null }

    const docUser = await superuserPrisma.user.create({
      data: { branchId: branch.id, name: "Dr. Notify", email: `dr-notif-${Date.now()}@test.local`, passwordHash: "x", role: Role.DOCTOR },
    })
    const doctor = await superuserPrisma.doctor.create({
      data: { userId: docUser.id, branchId: branch.id, licenseNumber: "N1", consultationFee: 50000 },
    })
    doctorId = doctor.id
    doctorUser = { id: docUser.id, role: Role.DOCTOR, branchId: branch.id, holdingCompanyId: null }
  })

  afterEach(async () => {
    await superuserPrisma.notification.deleteMany({ where: { branchId: branch.id } })
    await superuserPrisma.medicineDispensed.deleteMany({ where: { branchId: branch.id } })
    await superuserPrisma.payment.deleteMany({ where: { branchId: branch.id } })
    await superuserPrisma.consultation.deleteMany({ where: { branchId: branch.id } })
    await superuserPrisma.queueEntry.deleteMany({ where: { branchId: branch.id } })
    await superuserPrisma.patient.deleteMany({ where: { branchId: branch.id } })
  })

  afterAll(async () => {
    await superuserPrisma.doctor.deleteMany({ where: { branchId: branch.id } })
    await superuserPrisma.user.deleteMany({ where: { branchId: branch.id } })
    const { clinicId } = await superuserPrisma.branch.findUniqueOrThrow({ where: { id: branch.id }, select: { clinicId: true } })
    await superuserPrisma.branch.delete({ where: { id: branch.id } })
    await superuserPrisma.clinic.delete({ where: { id: clinicId } })
    await superuserPrisma.holdingCompany.deleteMany({ where: { name: "Notification Test Holding" } })
    await superuserPrisma.$disconnect()
    await prisma.$disconnect()
  })

  it("public booking writes a booking_confirmed notification with fully rendered text", async () => {
    const result = await createPublicBooking(branch.slug, {
      firstName: "Ana",
      lastName: "Reyes",
      birthdate: "1992-05-10",
      sex: "FEMALE",
      phone: "+63 917 111 2222",
      address: "addr",
      emergencyContactName: "ec",
      emergencyContactPhone: "+63 917 111 3333",
      reasonForVisit: "Checkup",
      priority: false,
      preferredDate: "today",
      consent: true,
    })

    const notification = await superuserPrisma.notification.findFirstOrThrow({
      where: { patientId: result.patient.id, templateKey: "booking_confirmed" },
    })
    expect(notification.channel).toBe("SMS")
    expect(["SENT", "MOCKED"]).toContain(notification.status)
    const payload = notification.payload as { renderedMessage?: string }
    expect(payload.renderedMessage).toContain(String(result.queueEntry.queueNumber))
    expect(payload.renderedMessage).toContain(result.accessToken)
    expect(payload.renderedMessage).toContain(branch.name)
  })

  it("calling the next patient writes a now_serving notification with the queue number in the text", async () => {
    const patient = await createPatient()
    const entry = await createActiveEntry(patient.id)

    await callNextEntry(frontDesk)

    const notification = await superuserPrisma.notification.findFirstOrThrow({
      where: { queueEntryId: entry.id, templateKey: "now_serving" },
    })
    const payload = notification.payload as { renderedMessage?: string }
    expect(payload.renderedMessage).toContain(String(entry.queueNumber))
  })

  it("almost_your_turn fires for patients newly within 3 places, and only once per patient", async () => {
    const patients = await Promise.all(Array.from({ length: 5 }, (_, i) => createPatient({ firstName: `P${i}` })))
    const entries = []
    for (let i = 0; i < patients.length; i++) {
      entries.push(await createActiveEntry(patients[i].id, { checkedInAt: new Date(Date.now() + i * 1000) }))
    }

    await callNextEntry(frontDesk)
    // calls entries[0]. Remaining active pool is [1,2,3,4]; position 0 of
    // *that* pool (entries[1], now literally next up) is skipped by the
    // same "position 0 gets `now_serving` instead" rule, so positions 1-3
    // of the remaining pool — entries[2], entries[3], entries[4] — get
    // almost_your_turn.
    const notified = await superuserPrisma.notification.findMany({ where: { branchId: branch.id, templateKey: "almost_your_turn" } })
    expect(notified.map((n) => n.queueEntryId).sort()).toEqual([entries[2].id, entries[3].id, entries[4].id].sort())

    // calling again must not re-notify anyone already sent one
    await callNextEntry(frontDesk) // calls entries[1]; remaining pool [2,3,4] all already notified from round 1
    const notifiedAfter = await superuserPrisma.notification.findMany({ where: { branchId: branch.id, templateKey: "almost_your_turn" } })
    const uniqueQueueEntryIds = new Set(notifiedAfter.map((n) => n.queueEntryId))
    expect(uniqueQueueEntryIds.size).toBe(notifiedAfter.length) // no duplicates
    expect(notifiedAfter.length).toBe(3) // nothing new — everyone in range was already notified
  })

  it("a no-show writes a no_show notification", async () => {
    const patient = await createPatient()
    const entry = await createActiveEntry(patient.id)
    await markNoShow(frontDesk, entry.id)

    const notification = await superuserPrisma.notification.findFirstOrThrow({
      where: { queueEntryId: entry.id, templateKey: "no_show" },
    })
    const payload = notification.payload as { renderedMessage?: string }
    expect(payload.renderedMessage).toContain("missed you")
  })

  it("lists notifications scoped to the branch, newest first", async () => {
    const patient = await createPatient()
    const entry = await createActiveEntry(patient.id)
    await callNextEntry(frontDesk)

    const log = await listNotifications(frontDesk)
    expect(log.some((n) => n.templateKey === "now_serving" && n.renderedMessage.includes(String(entry.queueNumber)))).toBe(true)
  })

  it("the follow-up list surfaces a due consultation, and sending writes a follow_up_due notification", async () => {
    const patient = await createPatient()
    const entry = await createActiveEntry(patient.id, {})
    await superuserPrisma.queueEntry.update({ where: { id: entry.id }, data: { status: "CALLED", doctorId } })

    const yesterday = new Date(Date.now() - 86_400_000)
    const { consultationId } = await saveConsultation(doctorUser, entry.id, {
      chiefComplaint: "x",
      followUpDate: yesterday.toISOString(),
      medicines: [],
      payment: { amount: 0, method: "CASH" },
    })

    const dueList = await listDueFollowUps(frontDesk)
    const due = dueList.find((d) => d.consultationId === consultationId)
    expect(due).toBeTruthy()
    expect(due?.isOverdue).toBe(true)
    expect(due?.alreadySent).toBe(false)

    await sendFollowUpReminder(frontDesk, consultationId)

    const notification = await superuserPrisma.notification.findFirstOrThrow({
      where: { queueEntryId: entry.id, templateKey: "follow_up_due" },
    })
    const payload = notification.payload as { renderedMessage?: string }
    expect(payload.renderedMessage).toContain("Dr. Notify")

    const dueListAfter = await listDueFollowUps(frontDesk)
    expect(dueListAfter.find((d) => d.consultationId === consultationId)?.alreadySent).toBe(true)
  })
})
