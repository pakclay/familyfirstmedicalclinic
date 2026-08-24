import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { Role, Sex, QueueSource } from "@prisma/client"
import { superuserPrisma } from "@/lib/test/superuser-prisma"
import { prisma } from "@/lib/db/prisma"
import {
  listTodayQueue,
  listDoctorQueue,
  checkInBookedEntry,
  assignDoctor,
  callNextEntry,
  recallEntry,
  markNoShow,
  startConsultationForQueueEntry,
  moveQueueEntryOrder,
  todayAsQueueDate,
} from "@/lib/queries/queue"
import { getPublicDisplayState, getPatientStatusByToken } from "@/lib/queries/public-queue"
import { createPublicBooking } from "@/lib/queries/booking"
import type { AbilitySubject } from "@/lib/permissions/ability"

/**
 * M3's accept bar (§12): "booking and walk-in entries interleave correctly
 * by priority and time, Call Next advances state, and the patient status
 * page and display screen both reflect it within 10 seconds." The polling
 * interval itself isn't testable here (it's a client `setInterval`); this
 * covers the state transitions and query results the poll re-fetches.
 */
describe("queue", () => {
  let branch: { id: string; slug: string; timezone: string }
  let frontDesk: AbilitySubject
  let doctorA: AbilitySubject
  let doctorAId: string
  let doctorBId: string
  const queueDate = () => todayAsQueueDate(branch.timezone)

  async function createPatient(overrides: { firstName?: string; lastName?: string; phone?: string; birthdate?: Date } = {}) {
    return superuserPrisma.patient.create({
      data: {
        branchId: branch.id,
        firstName: "Test",
        lastName: `Patient${Math.random().toString(36).slice(2, 8)}`,
        birthdate: new Date("1990-01-01"),
        sex: Sex.FEMALE,
        phone: `+63 917 ${Math.floor(1000000 + Math.random() * 8999999)}`,
        address: "addr",
        emergencyContactName: "ec",
        emergencyContactPhone: "000",
        ...overrides,
      },
    })
  }

  let entryCounter = 0
  async function createEntry(opts: {
    patientId: string
    status: "BOOKED" | "CHECKED_IN" | "WAITING" | "CALLED"
    priority?: "NORMAL" | "PRIORITY"
    checkedInAt?: Date
    doctorId?: string
    source?: QueueSource
  }) {
    entryCounter += 1
    return superuserPrisma.queueEntry.create({
      data: {
        branchId: branch.id,
        patientId: opts.patientId,
        queueNumber: 1000 + entryCounter, // out of the way of numbers the code under test allocates itself
        queueDate: queueDate(),
        status: opts.status,
        priority: opts.priority ?? "NORMAL",
        source: opts.source ?? QueueSource.WALK_IN,
        checkedInAt: opts.checkedInAt ?? new Date(),
        doctorId: opts.doctorId,
        accessToken: `test-token-${entryCounter}-${Date.now()}`,
      },
    })
  }

  beforeAll(async () => {
    const holding = await superuserPrisma.holdingCompany.create({ data: { name: "Queue Test Holding" } })
    const clinic = await superuserPrisma.clinic.create({ data: { holdingCompanyId: holding.id, name: "Queue Test Clinic" } })
    branch = await superuserPrisma.branch.create({
      data: {
        clinicId: clinic.id,
        name: "Queue Test Branch",
        slug: `queue-test-branch-${Date.now()}`,
        address: "1 Test St",
        city: "Test City",
        phone: "0000",
        timezone: "Asia/Manila",
        operatingHours: {},
      },
    })
    const fdUser = await superuserPrisma.user.create({
      data: { branchId: branch.id, name: "Front Desk", email: `fd-${Date.now()}@test.local`, passwordHash: "x", role: Role.FRONT_DESK },
    })
    frontDesk = { id: fdUser.id, role: Role.FRONT_DESK, branchId: branch.id, holdingCompanyId: null }

    const docUserA = await superuserPrisma.user.create({
      data: { branchId: branch.id, name: "Dr. A", email: `doc-a-${Date.now()}@test.local`, passwordHash: "x", role: Role.DOCTOR },
    })
    const docA = await superuserPrisma.doctor.create({
      data: { userId: docUserA.id, branchId: branch.id, licenseNumber: "A", consultationFee: 50000 },
    })
    doctorAId = docA.id
    doctorA = { id: docUserA.id, role: Role.DOCTOR, branchId: branch.id, holdingCompanyId: null }

    const docUserB = await superuserPrisma.user.create({
      data: { branchId: branch.id, name: "Dr. B", email: `doc-b-${Date.now()}@test.local`, passwordHash: "x", role: Role.DOCTOR },
    })
    const docB = await superuserPrisma.doctor.create({
      data: { userId: docUserB.id, branchId: branch.id, licenseNumber: "B", consultationFee: 50000 },
    })
    doctorBId = docB.id
  })

  // Every test's queue entries are cleared afterward so ordering/neighbor
  // assertions in one test are never affected by another test's leftover
  // CHECKED_IN/WAITING/CALLED rows in the same branch+day — `callNextEntry`,
  // `moveQueueEntryOrder`, and the public display's "next 3" all query
  // across *all* of today's entries for the branch, not just the ones a
  // given test created.
  afterEach(async () => {
    await superuserPrisma.queueEntry.deleteMany({ where: { branchId: branch.id } })
  })

  afterAll(async () => {
    const clinicId = (await superuserPrisma.branch.findUniqueOrThrow({ where: { id: branch.id }, select: { clinicId: true } })).clinicId
    await superuserPrisma.auditLog.deleteMany({ where: { branchId: branch.id } })
    // notifications.patient_id is ON DELETE RESTRICT (queue_entry_id is
    // SET NULL, which is why afterEach's queueEntry cleanup alone never
    // needed this) — M5 wired real notification sends into callNextEntry/
    // markNoShow/moveQueueEntryOrder, so tests that exercise those now
    // leave rows here too.
    await superuserPrisma.notification.deleteMany({ where: { branchId: branch.id } })
    await superuserPrisma.patient.deleteMany({ where: { branchId: branch.id } })
    await superuserPrisma.doctor.deleteMany({ where: { branchId: branch.id } })
    await superuserPrisma.user.deleteMany({ where: { branchId: branch.id } })
    await superuserPrisma.branch.delete({ where: { id: branch.id } })
    await superuserPrisma.clinic.delete({ where: { id: clinicId } })
    await superuserPrisma.holdingCompany.deleteMany({ where: { name: "Queue Test Holding" } })
    await superuserPrisma.$disconnect()
    await prisma.$disconnect()
  })

  it("calls a priority entry ahead of a normal one that checked in earlier — priority always wins over time", async () => {
    const p1 = await createPatient()
    const p2 = await createPatient()
    // p1 checked in first (earlier time) but normal priority
    const early = await createEntry({ patientId: p1.id, status: "CHECKED_IN", checkedInAt: new Date(Date.now() - 60_000) })
    // p2 checked in later but flagged priority
    const late = await createEntry({ patientId: p2.id, status: "CHECKED_IN", priority: "PRIORITY", checkedInAt: new Date() })

    const called1 = await callNextEntry(frontDesk)
    expect(called1?.id).toBe(late.id) // priority entry called first despite checking in later
    const called2 = await callNextEntry(frontDesk)
    expect(called2?.id).toBe(early.id)

    const board = await listTodayQueue(frontDesk)
    expect(board.map((e) => e.id)).toEqual(expect.arrayContaining([early.id, late.id]))
  })

  it("interleaves a booking (checked in later) and a walk-in correctly by time within the same priority tier", async () => {
    const walkIn = await createPatient()
    const booking = await createPatient()
    const walkInEntry = await createEntry({ patientId: walkIn.id, status: "CHECKED_IN", checkedInAt: new Date(Date.now() - 30_000) })
    const bookingEntry = await createEntry({
      patientId: booking.id,
      status: "CHECKED_IN",
      checkedInAt: new Date(),
      source: QueueSource.FACEBOOK,
    })

    const first = await callNextEntry(frontDesk)
    const second = await callNextEntry(frontDesk)
    expect(first?.id).toBe(walkInEntry.id)
    expect(second?.id).toBe(bookingEntry.id)
    expect(second?.source).toBe("FACEBOOK")
  })

  it("checks in a booked entry", async () => {
    const patient = await createPatient()
    const entry = await createEntry({ patientId: patient.id, status: "BOOKED" })
    const updated = await checkInBookedEntry(frontDesk, entry.id)
    expect(updated.status).toBe("CHECKED_IN")
    expect(updated.checkedInAt).toBeTruthy()
  })

  it("assigns a doctor and moves CHECKED_IN to WAITING", async () => {
    const patient = await createPatient()
    const entry = await createEntry({ patientId: patient.id, status: "CHECKED_IN" })
    const updated = await assignDoctor(frontDesk, entry.id, doctorAId)
    expect(updated.status).toBe("WAITING")
    expect(updated.doctorId).toBe(doctorAId)
  })

  it("assigns a doctor to an already-CALLED entry without reverting its status", async () => {
    const patient = await createPatient()
    const entry = await createEntry({ patientId: patient.id, status: "CALLED" })
    const updated = await assignDoctor(frontDesk, entry.id, doctorAId)
    expect(updated.status).toBe("CALLED")
    expect(updated.doctorId).toBe(doctorAId)
    // and starting the consultation now works, since a doctor is assigned
    const started = await startConsultationForQueueEntry(frontDesk, entry.id)
    expect(started.status).toBe("IN_CONSULTATION")
  })

  it("rejects assigning a doctor from a different branch", async () => {
    const otherClinic = await superuserPrisma.clinic.create({ data: { name: "Other" } })
    const otherBranch = await superuserPrisma.branch.create({
      data: { clinicId: otherClinic.id, name: "Other", slug: `other-${Date.now()}`, address: "x", city: "x", phone: "0", timezone: "Asia/Manila", operatingHours: {} },
    })
    const otherDocUser = await superuserPrisma.user.create({
      data: { branchId: otherBranch.id, name: "Other Doc", email: `other-doc-${Date.now()}@test.local`, passwordHash: "x", role: Role.DOCTOR },
    })
    const otherDoc = await superuserPrisma.doctor.create({
      data: { userId: otherDocUser.id, branchId: otherBranch.id, licenseNumber: "X", consultationFee: 50000 },
    })
    const patient = await createPatient()
    const entry = await createEntry({ patientId: patient.id, status: "CHECKED_IN" })

    await expect(assignDoctor(frontDesk, entry.id, otherDoc.id)).rejects.toThrow()

    await superuserPrisma.doctor.delete({ where: { id: otherDoc.id } })
    await superuserPrisma.user.delete({ where: { id: otherDocUser.id } })
    await superuserPrisma.branch.delete({ where: { id: otherBranch.id } })
    await superuserPrisma.clinic.delete({ where: { id: otherClinic.id } })
  })

  it("recalls a called entry and marks a no-show", async () => {
    const patient = await createPatient()
    const entry = await createEntry({ patientId: patient.id, status: "CALLED" })
    const recalled = await recallEntry(frontDesk, entry.id)
    expect(recalled.status).toBe("CALLED")

    const noShow = await markNoShow(frontDesk, entry.id)
    expect(noShow.status).toBe("NO_SHOW")
  })

  it("won't start a consultation without a doctor assigned, but will once one is", async () => {
    const patient = await createPatient()
    const entry = await createEntry({ patientId: patient.id, status: "CALLED" })
    await expect(startConsultationForQueueEntry(frontDesk, entry.id)).rejects.toThrow("Assign a doctor")

    await superuserPrisma.queueEntry.update({ where: { id: entry.id }, data: { doctorId: doctorAId } })
    const started = await startConsultationForQueueEntry(frontDesk, entry.id)
    expect(started.status).toBe("IN_CONSULTATION")
  })

  it("a doctor's queue only shows their own assigned patients", async () => {
    const patientMine = await createPatient()
    const patientOther = await createPatient()
    const mine = await createEntry({ patientId: patientMine.id, status: "WAITING", doctorId: doctorAId })
    await createEntry({ patientId: patientOther.id, status: "WAITING", doctorId: doctorBId })

    const list = await listDoctorQueue(doctorA)
    expect(list.map((e) => e.id)).toContain(mine.id)
    expect(list.every((e) => e.doctorId === doctorAId)).toBe(true)
  })

  it("moves a waiting entry up, swapping checked-in time with its neighbor, and audit-logs it", async () => {
    const p1 = await createPatient()
    const p2 = await createPatient()
    const first = await createEntry({ patientId: p1.id, status: "CHECKED_IN", checkedInAt: new Date(Date.now() - 10_000) })
    const second = await createEntry({ patientId: p2.id, status: "CHECKED_IN", checkedInAt: new Date() })

    await moveQueueEntryOrder(frontDesk, second.id, "up")

    const [reFirst, reSecond] = await Promise.all([
      superuserPrisma.queueEntry.findUniqueOrThrow({ where: { id: first.id } }),
      superuserPrisma.queueEntry.findUniqueOrThrow({ where: { id: second.id } }),
    ])
    expect(reSecond.checkedInAt!.getTime()).toBeLessThan(reFirst.checkedInAt!.getTime())

    const log = await superuserPrisma.auditLog.findFirst({ where: { entityId: second.id, action: "queue_entry.reorder" } })
    expect(log).toBeTruthy()
  })

  it("public display shows queue numbers only, never patient names", async () => {
    const patient = await createPatient({ firstName: "Secret", lastName: "Name" })
    const entry = await createEntry({ patientId: patient.id, status: "CHECKED_IN" })

    const state = await getPublicDisplayState(branch.slug)
    expect(state).toBeTruthy()
    expect(JSON.stringify(state)).not.toContain("Secret")
    expect(JSON.stringify(state)).not.toContain(patient.id)
    expect(state!.next).toContain(entry.queueNumber)
  })

  it("public booking creates a BOOKED, source=FACEBOOK entry and auto-matches an existing patient", async () => {
    const existing = await createPatient({ firstName: "Repeat", lastName: "Visitor", phone: "+63 917 222 3333", birthdate: new Date("1980-02-02") })

    const booking = await createPublicBooking(branch.slug, {
      firstName: "Repeat",
      lastName: "Visitor",
      birthdate: "1980-02-02",
      sex: "FEMALE",
      phone: "09172223333", // same number, different formatting
      address: "addr",
      emergencyContactName: "ec",
      emergencyContactPhone: "+63 917 000 0000",
      reasonForVisit: "Checkup",
      priority: false,
      preferredDate: "today",
      consent: true,
    })

    expect(booking.patient.id).toBe(existing.id) // matched, not duplicated
    expect(booking.queueEntry.status).toBe("BOOKED")
    expect(booking.queueEntry.source).toBe("FACEBOOK")
    expect(booking.accessToken).toBeTruthy()
  })

  it("patient status by token reflects position and expires for a different day", async () => {
    const patient = await createPatient()
    const entry = await createEntry({ patientId: patient.id, status: "CHECKED_IN", checkedInAt: new Date(Date.now() + 3_600_000) })

    const status = await getPatientStatusByToken(entry.accessToken)
    expect(status?.queueNumber).toBe(entry.queueNumber)
    expect(status?.patientsAhead).toBeGreaterThanOrEqual(0)

    // a token for a different day's entry is treated as not (yet/still) live
    await superuserPrisma.queueEntry.update({
      where: { id: entry.id },
      data: { queueDate: new Date(Date.UTC(2000, 0, 1)) },
    })
    const expired = await getPatientStatusByToken(entry.accessToken)
    expect(expired).toBeNull()
  })

  it("returns null for an unknown token", async () => {
    const status = await getPatientStatusByToken("does-not-exist")
    expect(status).toBeNull()
  })
})
