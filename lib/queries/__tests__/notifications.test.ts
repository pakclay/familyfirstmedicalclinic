import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { Role, Sex } from "@prisma/client"
import { superuserPrisma } from "@/lib/test/superuser-prisma"
import { prisma } from "@/lib/db/prisma"
import { callNextEntry, markNoShow, todayAsQueueDate } from "@/lib/queries/queue"
import { createPublicBooking } from "@/lib/queries/booking"
import { listNotifications, listDueFollowUps, sendFollowUpReminder } from "@/lib/queries/notifications"
import { saveConsultation } from "@/lib/queries/consultations"
import { ForbiddenError } from "@/lib/permissions/errors"
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

/**
 * Branch isolation for the notification log. The suite above proves
 * notifications get written; it says nothing about who can read them,
 * because it only ever has one branch to look at.
 *
 * The boundary the branch tier introduces is between two branches of the
 * SAME clinic — a cross-*clinic* fixture cannot catch a regression that
 * leaks between siblings. So the fixture here is one holding company,
 * two clinics, and THREE branches: branchA, siblingOfA (same clinic as
 * branchA — the whole point) and branchB (different clinic, the older
 * control).
 *
 * Notification rows are the worst thing in the schema to leak: `payload`
 * carries the fully rendered SMS text plus the destination phone number,
 * i.e. a patient's name and mobile number in plain text. Assertions
 * therefore target that payload, not just row ids.
 *
 * Both enforcement layers are covered independently — the app layer
 * (branchId in the where-clause / ForbiddenError) and the Postgres RLS
 * backstop — and every isolation assertion is paired with a positive
 * control, because "the sibling's row is absent" also passes against a
 * wiped table or a query that returns nothing at all.
 */
describe("branch scoping — notifications", () => {
  const stamp = Date.now()
  const OWN_SURNAME = "OwnBranch-NotifIso"
  const OWN_PHONE = "+63 917 555 0101"
  const SIBLING_SURNAME = "SiblingBranch-NotifIso"
  const SIBLING_PHONE = "+63 917 555 0102"
  const OTHER_CLINIC_SURNAME = "OtherClinic-NotifIso"
  const OTHER_CLINIC_PHONE = "+63 917 555 0103"

  let branchA: { id: string }
  let siblingOfA: { id: string }
  let branchB: { id: string }
  let frontDeskA: AbilitySubject
  let ownNotificationId: string
  let siblingNotificationId: string
  let branchBNotificationId: string
  let ownConsultationId: string
  let siblingConsultationId: string
  let branchBConsultationId: string

  const branchIds = () => [branchA.id, siblingOfA.id, branchB.id]

  async function createBranch(clinicId: string, name: string, slug: string) {
    return superuserPrisma.branch.create({
      data: {
        clinicId,
        name,
        slug,
        address: "1 Test St",
        city: "Test City",
        phone: "+63 900 000 0000",
        timezone: "Asia/Manila",
        operatingHours: {},
      },
    })
  }

  async function createDoctor(branchId: string, label: string) {
    const user = await superuserPrisma.user.create({
      data: {
        branchId,
        name: `Dr. ${label}`,
        email: `dr-notif-iso-${label.toLowerCase()}-${stamp}@test.local`,
        passwordHash: "x",
        role: Role.DOCTOR,
      },
    })
    return superuserPrisma.doctor.create({
      data: { userId: user.id, branchId, licenseNumber: `NI-${label}`, consultationFee: 50000 },
    })
  }

  async function createPatientIn(branchId: string, firstName: string, lastName: string, phone: string) {
    return superuserPrisma.patient.create({
      data: {
        branchId,
        firstName,
        lastName,
        birthdate: new Date("1990-01-01"),
        sex: Sex.FEMALE,
        phone,
        address: "addr",
        emergencyContactName: "ec",
        emergencyContactPhone: "+63 917 000 0000",
      },
    })
  }

  /** An overdue follow-up, i.e. one listDueFollowUps must surface for its own branch. */
  async function createOverdueConsultation(opts: { branchId: string; patientId: string; doctorId: string; queueNumber: number; token: string }) {
    const today = todayAsQueueDate("Asia/Manila")
    const yesterday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1))
    const entry = await superuserPrisma.queueEntry.create({
      data: {
        branchId: opts.branchId,
        patientId: opts.patientId,
        doctorId: opts.doctorId,
        queueNumber: opts.queueNumber,
        queueDate: today,
        status: "CALLED",
        source: "WALK_IN",
        checkedInAt: new Date(),
        accessToken: opts.token,
      },
    })
    const consultation = await superuserPrisma.consultation.create({
      data: {
        queueEntryId: entry.id,
        patientId: opts.patientId,
        doctorId: opts.doctorId,
        branchId: opts.branchId,
        chiefComplaint: "notif-iso fixture",
        followUpDate: yesterday,
      },
    })
    return consultation
  }

  /**
   * Written with superuserPrisma on purpose: these rows are exactly what
   * the app refuses to write cross-branch, and the point is to have them
   * exist so the read paths can be caught leaking them.
   */
  async function createNotification(branchId: string, patientId: string, surname: string, phone: string) {
    const row = await superuserPrisma.notification.create({
      data: {
        branchId,
        patientId,
        channel: "SMS",
        templateKey: "follow_up_due",
        payload: {
          patientName: surname,
          clinicName: "Notif Iso",
          doctorName: "Dr. X",
          followUpDate: "September 1, 2026",
          renderedMessage: `Hi ${surname}, this is a reminder for your follow-up checkup. Sent to ${phone}.`,
          to: phone,
        },
        status: "MOCKED",
        sentAt: new Date(),
      },
    })
    return row
  }

  beforeAll(async () => {
    const holding = await superuserPrisma.holdingCompany.create({ data: { name: "Notification Isolation Test Holding" } })
    const clinicA = await superuserPrisma.clinic.create({ data: { holdingCompanyId: holding.id, name: "Notif Iso Clinic A" } })
    const clinicB = await superuserPrisma.clinic.create({ data: { holdingCompanyId: holding.id, name: "Notif Iso Clinic B" } })

    branchA = await createBranch(clinicA.id, "Notif Iso Branch A", `notif-iso-a-${stamp}`)
    // Same clinic as branchA — sharing a parent must buy no access.
    siblingOfA = await createBranch(clinicA.id, "Notif Iso Branch A Sibling", `notif-iso-a-sibling-${stamp}`)
    branchB = await createBranch(clinicB.id, "Notif Iso Branch B", `notif-iso-b-${stamp}`)

    const fdUser = await superuserPrisma.user.create({
      data: {
        branchId: branchA.id,
        name: "Front Desk Iso A",
        email: `fd-notif-iso-a-${stamp}@test.local`,
        passwordHash: "x",
        role: Role.FRONT_DESK,
      },
    })
    frontDeskA = { id: fdUser.id, role: Role.FRONT_DESK, branchId: branchA.id, holdingCompanyId: null }

    const doctorA = await createDoctor(branchA.id, "IsoA")
    const doctorSibling = await createDoctor(siblingOfA.id, "IsoSib")
    const doctorB = await createDoctor(branchB.id, "IsoB")

    const patientA = await createPatientIn(branchA.id, "Owena", OWN_SURNAME, OWN_PHONE)
    const patientSibling = await createPatientIn(siblingOfA.id, "Sibylla", SIBLING_SURNAME, SIBLING_PHONE)
    const patientB = await createPatientIn(branchB.id, "Bianca", OTHER_CLINIC_SURNAME, OTHER_CLINIC_PHONE)

    ownNotificationId = (await createNotification(branchA.id, patientA.id, OWN_SURNAME, OWN_PHONE)).id
    siblingNotificationId = (await createNotification(siblingOfA.id, patientSibling.id, SIBLING_SURNAME, SIBLING_PHONE)).id
    branchBNotificationId = (await createNotification(branchB.id, patientB.id, OTHER_CLINIC_SURNAME, OTHER_CLINIC_PHONE)).id

    ownConsultationId = (
      await createOverdueConsultation({ branchId: branchA.id, patientId: patientA.id, doctorId: doctorA.id, queueNumber: 9101, token: `notif-iso-a-${stamp}` })
    ).id
    siblingConsultationId = (
      await createOverdueConsultation({
        branchId: siblingOfA.id,
        patientId: patientSibling.id,
        doctorId: doctorSibling.id,
        queueNumber: 9102,
        token: `notif-iso-sib-${stamp}`,
      })
    ).id
    branchBConsultationId = (
      await createOverdueConsultation({ branchId: branchB.id, patientId: patientB.id, doctorId: doctorB.id, queueNumber: 9103, token: `notif-iso-b-${stamp}` })
    ).id
  })

  afterAll(async () => {
    const ids = branchIds()
    const clinicIds = (await superuserPrisma.branch.findMany({ where: { id: { in: ids } }, select: { clinicId: true } })).map((b) => b.clinicId)
    await superuserPrisma.auditLog.deleteMany({ where: { branchId: { in: ids } } })
    await superuserPrisma.notification.deleteMany({ where: { branchId: { in: ids } } })
    await superuserPrisma.consultation.deleteMany({ where: { branchId: { in: ids } } })
    await superuserPrisma.queueEntry.deleteMany({ where: { branchId: { in: ids } } })
    await superuserPrisma.patient.deleteMany({ where: { branchId: { in: ids } } })
    await superuserPrisma.doctor.deleteMany({ where: { branchId: { in: ids } } })
    await superuserPrisma.user.deleteMany({ where: { branchId: { in: ids } } })
    await superuserPrisma.branch.deleteMany({ where: { id: { in: ids } } })
    await superuserPrisma.clinic.deleteMany({ where: { id: { in: clinicIds } } })
    await superuserPrisma.holdingCompany.deleteMany({ where: { name: "Notification Isolation Test Holding" } })
    await superuserPrisma.$disconnect()
    await prisma.$disconnect()
  })

  it("listNotifications hides a sibling branch's notification — including the patient name and phone in its rendered SMS text", async () => {
    const log = await listNotifications(frontDeskA)

    // Positive control: without this, every assertion below would pass
    // just as well against an empty list or a wiped notifications table.
    const own = log.find((n) => n.id === ownNotificationId)
    expect(own).toBeTruthy()
    expect(own?.renderedMessage).toContain(OWN_SURNAME)
    expect(own?.renderedMessage).toContain(OWN_PHONE)

    expect(log.map((n) => n.id)).not.toContain(siblingNotificationId)
    // The id being absent isn't enough — the payload is the sensitive part.
    expect(log.some((n) => n.renderedMessage.includes(SIBLING_SURNAME))).toBe(false)
    expect(log.some((n) => n.renderedMessage.includes(SIBLING_PHONE))).toBe(false)
    expect(log.some((n) => n.patientName.includes(SIBLING_SURNAME))).toBe(false)
  })

  it("listNotifications hides another clinic's branch notification, payload included", async () => {
    const log = await listNotifications(frontDeskA)

    expect(log.map((n) => n.id)).toContain(ownNotificationId) // positive control

    expect(log.map((n) => n.id)).not.toContain(branchBNotificationId)
    expect(log.some((n) => n.renderedMessage.includes(OTHER_CLINIC_SURNAME))).toBe(false)
    expect(log.some((n) => n.renderedMessage.includes(OTHER_CLINIC_PHONE))).toBe(false)
    expect(log.some((n) => n.patientName.includes(OTHER_CLINIC_SURNAME))).toBe(false)
  })

  it("sendFollowUpReminder 403s for a sibling branch's consultation, and renders no message at all", async () => {
    const before = await superuserPrisma.notification.count({ where: { branchId: siblingOfA.id, templateKey: "follow_up_due" } })
    // Positive control for the counting itself: the sibling branch really
    // does have follow_up_due rows, so a count that stays flat below is a
    // live count and not a query looking at an empty table.
    expect(before).toBeGreaterThan(0)

    await expect(sendFollowUpReminder(frontDeskA, siblingConsultationId)).rejects.toBeInstanceOf(ForbiddenError)

    // Refusal has to happen *before* the template is rendered and sent —
    // an extra row here would mean the patient's phone was dialled with
    // their name in the body before anyone checked the branch.
    const after = await superuserPrisma.notification.count({ where: { branchId: siblingOfA.id, templateKey: "follow_up_due" } })
    expect(after).toBe(before)
  })

  it("sendFollowUpReminder 403s for another clinic's branch consultation, and renders no message at all", async () => {
    const before = await superuserPrisma.notification.count({ where: { branchId: branchB.id, templateKey: "follow_up_due" } })
    expect(before).toBeGreaterThan(0) // positive control, as above

    await expect(sendFollowUpReminder(frontDeskA, branchBConsultationId)).rejects.toBeInstanceOf(ForbiddenError)

    const after = await superuserPrisma.notification.count({ where: { branchId: branchB.id, templateKey: "follow_up_due" } })
    expect(after).toBe(before)
  })

  it("listDueFollowUps excludes a sibling branch's overdue consultation while surfacing the caller's own", async () => {
    const due = await listDueFollowUps(frontDeskA)

    // Positive control: the own-branch overdue consultation IS listed, so
    // the exclusions below are about scoping and not about an empty list.
    const own = due.find((d) => d.consultationId === ownConsultationId)
    expect(own).toBeTruthy()
    expect(own?.isOverdue).toBe(true)
    expect(own?.patientName).toContain(OWN_SURNAME)

    expect(due.map((d) => d.consultationId)).not.toContain(siblingConsultationId)
    expect(due.some((d) => d.patientName.includes(SIBLING_SURNAME))).toBe(false)

    expect(due.map((d) => d.consultationId)).not.toContain(branchBConsultationId)
    expect(due.some((d) => d.patientName.includes(OTHER_CLINIC_SURNAME))).toBe(false)
  })

  it("RLS backstop: the sibling branch's notification row is invisible under Branch A's session context", async () => {
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.role', ${Role.FRONT_DESK}, true)`
      await tx.$executeRaw`SELECT set_config('app.user_id', ${frontDeskA.id}, true)`
      await tx.$executeRaw`SELECT set_config('app.branch_id', ${branchA.id}, true)`
      // deliberately unfiltered by branch — proves the database hides the
      // row, not just the app query's where-clause
      return tx.notification.findMany({ where: { id: siblingNotificationId } })
    })
    expect(rows).toHaveLength(0)

    // Positive control: identical query, identical code path, only
    // app.branch_id differs. A policy that hid every row unconditionally
    // would satisfy the toHaveLength(0) above just as well — this passing
    // is what proves the policy keys on app.branch_id.
    const visible = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.role', ${Role.FRONT_DESK}, true)`
      await tx.$executeRaw`SELECT set_config('app.user_id', ${frontDeskA.id}, true)`
      await tx.$executeRaw`SELECT set_config('app.branch_id', ${siblingOfA.id}, true)`
      return tx.notification.findMany({ where: { id: siblingNotificationId } })
    })
    expect(visible).toHaveLength(1)
    expect((visible[0].payload as { to?: string }).to).toBe(SIBLING_PHONE)
  })

  it("RLS backstop: another clinic's branch notification row is invisible under Branch A's session context", async () => {
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.role', ${Role.FRONT_DESK}, true)`
      await tx.$executeRaw`SELECT set_config('app.user_id', ${frontDeskA.id}, true)`
      await tx.$executeRaw`SELECT set_config('app.branch_id', ${branchA.id}, true)`
      return tx.notification.findMany({ where: { id: branchBNotificationId } })
    })
    expect(rows).toHaveLength(0)

    const visible = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.role', ${Role.FRONT_DESK}, true)`
      await tx.$executeRaw`SELECT set_config('app.user_id', ${frontDeskA.id}, true)`
      await tx.$executeRaw`SELECT set_config('app.branch_id', ${branchB.id}, true)`
      return tx.notification.findMany({ where: { id: branchBNotificationId } })
    })
    expect(visible).toHaveLength(1)
  })
})
