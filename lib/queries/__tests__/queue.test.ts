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
  nextQueueNumber,
  todayAsQueueDate,
} from "@/lib/queries/queue"
import { getPublicDisplayState, getPatientStatusByToken } from "@/lib/queries/public-queue"
import { createPublicBooking } from "@/lib/queries/booking"
import { ForbiddenError } from "@/lib/permissions/errors"
import { compareQueueOrder } from "@/lib/utils/queue-order"
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

/**
 * The boundary the Branch tier introduced: **two branches under the SAME
 * clinic must not see each other's queue.** The suite above is a
 * single-branch functional suite — with one branch in its fixture, every
 * `where: { branchId }` in lib/queries/queue.ts could be deleted and all 14
 * of its tests would still pass. The one test there that does involve a
 * second branch ("rejects assigning a doctor from a different branch")
 * builds a whole separate *clinic*, so it proves only the OLD cross-clinic
 * boundary.
 *
 * So this block's fixture mirrors patients.test.ts: one holding company,
 * clinicA + clinicB, and THREE branches — `branchQA` (clinicA),
 * `branchQB` (clinicB — the cross-clinic control), and `siblingQA`
 * (**clinicA, the same parent as branchQA**). siblingQA is the whole point.
 *
 * Both enforcement layers are covered independently:
 *   1. app layer — `requireBranchId(user)` feeding the Prisma where-clause
 *      (and `findBranchEntry`'s ForbiddenError choke point),
 *   2. the Postgres RLS backstop on `queue_entries`
 *      (prisma/migrations/20260824000004_branch_rewrite_rls_policies).
 *
 * Every isolation assertion carries a positive control — a "sibling row is
 * absent" assertion passes just as well against a wiped table or a broken
 * fixture, so the caller's own equivalent row is always asserted present in
 * the same result.
 */
describe("branch scoping — queue", () => {
  // Module-specific literal prefix: other test files run against this same
  // local database, and slug / email / access_token all carry unique
  // indexes. A bare Date.now() would eventually collide with a sibling file.
  const PREFIX = "qscope"
  const stamp = Date.now()
  const uniq = (label: string) => `${PREFIX}-${label}-${stamp}`

  let holdingId: string
  let clinicAId: string
  let clinicBId: string
  let clinicAName: string
  let branchQA: { id: string; slug: string; name: string; address: string; timezone: string }
  let siblingQA: { id: string; slug: string; name: string; address: string; timezone: string }
  let branchQB: { id: string; slug: string; name: string; address: string; timezone: string }
  let frontDeskA: AbilitySubject
  let doctorAUser: AbilitySubject
  let doctorAId: string
  let siblingDoctorId: string
  let holdingAdmin: AbilitySubject
  let holdingAdminId: string
  let patientOwn: { id: string }
  let patientSib: { id: string }
  let patientCross: { id: string }

  const scopeQueueDate = () => todayAsQueueDate("Asia/Manila")
  /** A day nothing else in this file (or any other) touches — lets the
   *  queue-number allocator be observed on a provably empty branch/day. */
  const ALLOC_DATE = new Date(Date.UTC(2031, 2, 3))

  let scopeCounter = 0
  async function scopeEntry(opts: {
    branchId: string
    patientId: string
    status: "BOOKED" | "CHECKED_IN" | "WAITING" | "CALLED" | "IN_CONSULTATION" | "NO_SHOW"
    priority?: "NORMAL" | "PRIORITY"
    checkedInAt?: Date | null
    calledAt?: Date | null
    doctorId?: string
    queueNumber?: number
    queueDate?: Date
    source?: QueueSource
  }) {
    scopeCounter += 1
    return superuserPrisma.queueEntry.create({
      data: {
        branchId: opts.branchId,
        patientId: opts.patientId,
        doctorId: opts.doctorId,
        queueNumber: opts.queueNumber ?? 9000 + scopeCounter,
        queueDate: opts.queueDate ?? scopeQueueDate(),
        status: opts.status,
        priority: opts.priority ?? "NORMAL",
        source: opts.source ?? QueueSource.WALK_IN,
        checkedInAt: opts.checkedInAt === undefined ? new Date() : opts.checkedInAt,
        calledAt: opts.calledAt ?? null,
        accessToken: uniq(`token-${scopeCounter}`),
      },
    })
  }

  const reread = (id: string) => superuserPrisma.queueEntry.findUniqueOrThrow({ where: { id } })

  beforeAll(async () => {
    const holding = await superuserPrisma.holdingCompany.create({ data: { name: `Queue Branch Scope Holding ${stamp}` } })
    holdingId = holding.id
    clinicAName = `Queue Scope Clinic A ${stamp}`
    const clinicA = await superuserPrisma.clinic.create({ data: { holdingCompanyId: holding.id, name: clinicAName } })
    const clinicB = await superuserPrisma.clinic.create({
      data: { holdingCompanyId: holding.id, name: `Queue Scope Clinic B ${stamp}` },
    })
    clinicAId = clinicA.id
    clinicBId = clinicB.id

    const makeBranch = (clinicId: string, name: string, slugLabel: string, address: string) =>
      superuserPrisma.branch.create({
        data: {
          clinicId,
          name,
          slug: uniq(slugLabel),
          address,
          city: "Test City",
          phone: "0000",
          timezone: "Asia/Manila",
          operatingHours: {},
        },
      })

    branchQA = await makeBranch(clinicA.id, "Scope Branch QA", "branch-qa", "1 QA Street")
    // SAME clinic as branchQA — the sibling boundary no cross-*clinic*
    // fixture can catch.
    siblingQA = await makeBranch(clinicA.id, "Scope Branch Sibling", "branch-sibling", "3 Sibling Street")
    // Different clinic — the old cross-clinic control, kept so a failure
    // tells you which of the two boundaries broke.
    branchQB = await makeBranch(clinicB.id, "Scope Branch QB", "branch-qb", "2 QB Street")

    const fdUser = await superuserPrisma.user.create({
      data: {
        branchId: branchQA.id,
        name: "Scope Front Desk A",
        email: `${uniq("fd-a")}@test.local`,
        passwordHash: "x",
        role: Role.FRONT_DESK,
      },
    })
    frontDeskA = { id: fdUser.id, role: Role.FRONT_DESK, branchId: branchQA.id, holdingCompanyId: null }

    const docUserA = await superuserPrisma.user.create({
      data: {
        branchId: branchQA.id,
        name: "Scope Dr. QA",
        email: `${uniq("doc-a")}@test.local`,
        passwordHash: "x",
        role: Role.DOCTOR,
      },
    })
    const docA = await superuserPrisma.doctor.create({
      data: { userId: docUserA.id, branchId: branchQA.id, licenseNumber: `${PREFIX}-A`, consultationFee: 50000 },
    })
    doctorAId = docA.id
    doctorAUser = { id: docUserA.id, role: Role.DOCTOR, branchId: branchQA.id, holdingCompanyId: null }

    const docUserSib = await superuserPrisma.user.create({
      data: {
        branchId: siblingQA.id,
        name: "Scope Dr. Sibling",
        email: `${uniq("doc-sib")}@test.local`,
        passwordHash: "x",
        role: Role.DOCTOR,
      },
    })
    const docSib = await superuserPrisma.doctor.create({
      data: { userId: docUserSib.id, branchId: siblingQA.id, licenseNumber: `${PREFIX}-S`, consultationFee: 50000 },
    })
    siblingDoctorId = docSib.id

    const haUser = await superuserPrisma.user.create({
      data: {
        holdingCompanyId: holding.id,
        name: "Scope Holding Admin",
        email: `${uniq("holding")}@test.local`,
        passwordHash: "x",
        role: Role.HOLDING_ADMIN,
      },
    })
    holdingAdminId = haUser.id
    holdingAdmin = { id: haUser.id, role: Role.HOLDING_ADMIN, branchId: null, holdingCompanyId: holding.id }

    const makePatient = (branchId: string, firstName: string, lastName: string, phone: string) =>
      superuserPrisma.patient.create({
        data: {
          branchId,
          firstName,
          lastName,
          birthdate: new Date("1990-01-01"),
          sex: Sex.FEMALE,
          phone,
          address: "addr",
          emergencyContactName: "ec",
          emergencyContactPhone: "000",
        },
      })

    // Distinctive, greppable names — several assertions below search the
    // serialized result for them, so they must not appear by accident.
    patientOwn = await makePatient(branchQA.id, "Ownside", "Alphapatient", "+63 917 1000001")
    patientSib = await makePatient(siblingQA.id, "Sibsecret", "Bravopatient", "+63 917 1000002")
    patientCross = await makePatient(branchQB.id, "Crossclinic", "Charliepatient", "+63 917 1000003")
  })

  afterEach(async () => {
    const ids = [branchQA.id, siblingQA.id, branchQB.id]
    await superuserPrisma.notification.deleteMany({ where: { branchId: { in: ids } } })
    await superuserPrisma.queueEntry.deleteMany({ where: { branchId: { in: ids } } })
  })

  afterAll(async () => {
    const ids = [branchQA.id, siblingQA.id, branchQB.id]
    await superuserPrisma.auditLog.deleteMany({ where: { branchId: { in: ids } } })
    await superuserPrisma.notification.deleteMany({ where: { branchId: { in: ids } } })
    await superuserPrisma.queueEntry.deleteMany({ where: { branchId: { in: ids } } })
    await superuserPrisma.patient.deleteMany({ where: { branchId: { in: ids } } })
    await superuserPrisma.doctor.deleteMany({ where: { branchId: { in: ids } } })
    await superuserPrisma.user.deleteMany({ where: { branchId: { in: ids } } })
    await superuserPrisma.user.deleteMany({ where: { id: holdingAdminId } })
    await superuserPrisma.branch.deleteMany({ where: { id: { in: ids } } })
    await superuserPrisma.clinic.deleteMany({ where: { id: { in: [clinicAId, clinicBId] } } })
    await superuserPrisma.holdingCompany.deleteMany({ where: { id: holdingId } })
    await superuserPrisma.$disconnect()
    await prisma.$disconnect()
  })

  // ── app layer: reads ────────────────────────────────────────────────────

  it("listTodayQueue shows the caller's own branch only — a sibling branch under the same clinic is not on the board", async () => {
    const own = await scopeEntry({ branchId: branchQA.id, patientId: patientOwn.id, status: "CHECKED_IN" })
    const sibling = await scopeEntry({ branchId: siblingQA.id, patientId: patientSib.id, status: "CHECKED_IN" })
    const cross = await scopeEntry({ branchId: branchQB.id, patientId: patientCross.id, status: "CHECKED_IN" })

    const board = await listTodayQueue(frontDeskA)
    const ids = board.map((e) => e.id)

    expect(ids).toContain(own.id) // positive control — the board is not simply empty
    expect(ids).not.toContain(sibling.id)
    expect(ids).not.toContain(cross.id)

    // StaffQueueEntryDTO carries `patientName`, so a leak here is a PHI leak,
    // not just an id leak.
    const serialized = JSON.stringify(board)
    expect(serialized).toContain("Ownside") // positive control for the name search itself
    expect(serialized).not.toContain("Sibsecret")
    expect(serialized).not.toContain("Crossclinic")
    expect(serialized).not.toContain(patientSib.id)
  })

  it("listDoctorQueue filters on branch as well as doctor — a sibling-branch entry assigned to the SAME doctor row stays out", async () => {
    const mine = await scopeEntry({
      branchId: branchQA.id,
      patientId: patientOwn.id,
      status: "WAITING",
      doctorId: doctorAId,
    })
    // A row the app itself would refuse to write (assignDoctor rejects a
    // doctor outside the entry's branch) — exactly what superuserPrisma is
    // for. It is the only shape that separates a `doctorId`-only filter
    // from `doctorId + branchId`.
    const siblingSameDoctor = await scopeEntry({
      branchId: siblingQA.id,
      patientId: patientSib.id,
      status: "WAITING",
      doctorId: doctorAId,
    })

    const list = await listDoctorQueue(doctorAUser)
    const ids = list.map((e) => e.id)

    expect(ids).toContain(mine.id) // positive control
    expect(ids).not.toContain(siblingSameDoctor.id)
    expect(JSON.stringify(list)).not.toContain("Sibsecret")
  })

  it("listTodayQueue refuses a holding admin outright rather than merging branches (a plain Error today, not ForbiddenError)", async () => {
    const own = await scopeEntry({ branchId: branchQA.id, patientId: patientOwn.id, status: "CHECKED_IN" })
    // positive control: the same board is readable by the branch-scoped user
    expect((await listTodayQueue(frontDeskA)).map((e) => e.id)).toContain(own.id)

    const err = await listTodayQueue(holdingAdmin).then(
      () => null,
      (e: unknown) => e
    )
    expect(err).toBeInstanceOf(Error)
    // Documenting what the code actually does (queue.ts:133) rather than
    // what would be consistent with the rest of the query layer — the
    // failure *shape* here is a separate hardening decision.
    expect(err).not.toBeInstanceOf(ForbiddenError)
    expect((err as Error).message).toContain("branch-scoped")
  })

  // ── app layer: id-taking mutators ───────────────────────────────────────

  it("checkInBookedEntry refuses a sibling branch's entry and leaves it untouched", async () => {
    const sibling = await scopeEntry({
      branchId: siblingQA.id,
      patientId: patientSib.id,
      status: "BOOKED",
      checkedInAt: null,
    })
    const before = await reread(sibling.id)

    await expect(checkInBookedEntry(frontDeskA, sibling.id)).rejects.toBeInstanceOf(ForbiddenError)
    expect(await reread(sibling.id)).toEqual(before)

    // positive control — the identical call on the caller's own equivalent entry works
    const own = await scopeEntry({ branchId: branchQA.id, patientId: patientOwn.id, status: "BOOKED", checkedInAt: null })
    const updated = await checkInBookedEntry(frontDeskA, own.id)
    expect(updated.status).toBe("CHECKED_IN")
  })

  it("assignDoctor refuses a sibling branch's entry and leaves it untouched", async () => {
    const sibling = await scopeEntry({ branchId: siblingQA.id, patientId: patientSib.id, status: "CHECKED_IN" })
    const before = await reread(sibling.id)

    await expect(assignDoctor(frontDeskA, sibling.id, doctorAId)).rejects.toBeInstanceOf(ForbiddenError)
    expect(await reread(sibling.id)).toEqual(before)

    const own = await scopeEntry({ branchId: branchQA.id, patientId: patientOwn.id, status: "CHECKED_IN" })
    const updated = await assignDoctor(frontDeskA, own.id, doctorAId) // positive control
    expect(updated.doctorId).toBe(doctorAId)
    expect(updated.status).toBe("WAITING")
  })

  it("assignDoctor refuses a SIBLING branch's doctor on the caller's own entry — the one path with no RLS backstop (doctors is unpoliced)", async () => {
    const own = await scopeEntry({ branchId: branchQA.id, patientId: patientOwn.id, status: "CHECKED_IN" })

    await expect(assignDoctor(frontDeskA, own.id, siblingDoctorId)).rejects.toBeInstanceOf(ForbiddenError)
    const afterDenial = await reread(own.id)
    expect(afterDenial.doctorId).toBeNull()
    expect(afterDenial.status).toBe("CHECKED_IN")

    // positive control: the same entry, the same call, an in-branch doctor
    const updated = await assignDoctor(frontDeskA, own.id, doctorAId)
    expect(updated.doctorId).toBe(doctorAId)
  })

  it("recallEntry refuses a sibling branch's entry and leaves it untouched", async () => {
    const sibling = await scopeEntry({
      branchId: siblingQA.id,
      patientId: patientSib.id,
      status: "CALLED",
      calledAt: new Date(Date.now() - 60_000),
    })
    const before = await reread(sibling.id)

    await expect(recallEntry(frontDeskA, sibling.id)).rejects.toBeInstanceOf(ForbiddenError)
    expect(await reread(sibling.id)).toEqual(before)

    const own = await scopeEntry({
      branchId: branchQA.id,
      patientId: patientOwn.id,
      status: "CALLED",
      calledAt: new Date(Date.now() - 60_000),
    })
    const recalled = await recallEntry(frontDeskA, own.id) // positive control
    expect(recalled.status).toBe("CALLED")
    expect(recalled.calledAt!.getTime()).toBeGreaterThan(own.calledAt!.getTime())
  })

  it("markNoShow refuses a sibling branch's entry and leaves it untouched", async () => {
    const sibling = await scopeEntry({ branchId: siblingQA.id, patientId: patientSib.id, status: "CALLED" })
    const before = await reread(sibling.id)

    await expect(markNoShow(frontDeskA, sibling.id)).rejects.toBeInstanceOf(ForbiddenError)
    expect(await reread(sibling.id)).toEqual(before)

    const own = await scopeEntry({ branchId: branchQA.id, patientId: patientOwn.id, status: "CALLED" })
    expect((await markNoShow(frontDeskA, own.id)).status).toBe("NO_SHOW") // positive control
  })

  it("startConsultationForQueueEntry refuses a sibling branch's entry and leaves it untouched", async () => {
    const sibling = await scopeEntry({
      branchId: siblingQA.id,
      patientId: patientSib.id,
      status: "CALLED",
      doctorId: siblingDoctorId,
    })
    const before = await reread(sibling.id)

    await expect(startConsultationForQueueEntry(frontDeskA, sibling.id)).rejects.toBeInstanceOf(ForbiddenError)
    expect(await reread(sibling.id)).toEqual(before)

    const own = await scopeEntry({
      branchId: branchQA.id,
      patientId: patientOwn.id,
      status: "CALLED",
      doctorId: doctorAId,
    })
    expect((await startConsultationForQueueEntry(frontDeskA, own.id)).status).toBe("IN_CONSULTATION") // positive control
  })

  it("moveQueueEntryOrder refuses a sibling branch's entry and reorders neither of the sibling's rows", async () => {
    const sibEarly = await scopeEntry({
      branchId: siblingQA.id,
      patientId: patientSib.id,
      status: "CHECKED_IN",
      checkedInAt: new Date(Date.now() - 10_000),
    })
    const sibLate = await scopeEntry({
      branchId: siblingQA.id,
      patientId: patientSib.id,
      status: "CHECKED_IN",
      checkedInAt: new Date(),
    })
    const beforeEarly = await reread(sibEarly.id)
    const beforeLate = await reread(sibLate.id)

    await expect(moveQueueEntryOrder(frontDeskA, sibLate.id, "up")).rejects.toBeInstanceOf(ForbiddenError)
    expect(await reread(sibEarly.id)).toEqual(beforeEarly)
    expect(await reread(sibLate.id)).toEqual(beforeLate)

    // positive control — the same operation on the caller's own pair swaps them
    const ownEarly = await scopeEntry({
      branchId: branchQA.id,
      patientId: patientOwn.id,
      status: "CHECKED_IN",
      checkedInAt: new Date(Date.now() - 10_000),
    })
    const ownLate = await scopeEntry({
      branchId: branchQA.id,
      patientId: patientOwn.id,
      status: "CHECKED_IN",
      checkedInAt: new Date(),
    })
    await moveQueueEntryOrder(frontDeskA, ownLate.id, "up")
    const [reEarly, reLate] = await Promise.all([reread(ownEarly.id), reread(ownLate.id)])
    expect(reLate.checkedInAt!.getTime()).toBeLessThan(reEarly.checkedInAt!.getTime())
  })

  it("callNextEntry never reaches into a sibling branch, even when the sibling's patient checked in first", async () => {
    // Checked in a full minute earlier — if the branch filter vanished this
    // is the row callNextEntry would pick.
    const sibling = await scopeEntry({
      branchId: siblingQA.id,
      patientId: patientSib.id,
      status: "CHECKED_IN",
      checkedInAt: new Date(Date.now() - 60_000),
    })
    const own = await scopeEntry({
      branchId: branchQA.id,
      patientId: patientOwn.id,
      status: "CHECKED_IN",
      checkedInAt: new Date(),
    })

    const called = await callNextEntry(frontDeskA)
    expect(called?.id).toBe(own.id) // positive control: it called *something*, and it was ours
    expect((await reread(sibling.id)).status).toBe("CHECKED_IN")

    // Drained: with our own branch empty it returns null rather than
    // falling through to the sibling's still-waiting patient.
    expect(await callNextEntry(frontDeskA)).toBeNull()
    expect((await reread(sibling.id)).status).toBe("CHECKED_IN")
  })

  // ── public, unauthenticated paths (highest risk) ─────────────────────────

  /**
   * getPatientStatusByToken runs entirely under `runWithFullVisibility()`,
   * which sets app.role='HOLDING_ADMIN' and so satisfies the OR arm of
   * *every* RLS policy — a deliberate master key, because the token lookup
   * has no branch to scope by until the row is found. That means the
   * `branchId: entry.branchId` filters on the patientsAhead and nowServing
   * queries (public-queue.ts:86, :94) are the ONLY thing keeping a sibling
   * branch out of those numbers; there is no second layer here. The fixture
   * below is arranged so deleting either filter changes the arithmetic
   * visibly.
   */
  async function seedTokenScenario() {
    const t = Date.now()
    const at = (msAgo: number) => new Date(t - msAgo)
    // Active (CHECKED_IN) entries, oldest first. Interleaved across branches
    // on purpose so a leak can't accidentally produce the right position.
    const ownVeryEarly = await scopeEntry({ branchId: branchQA.id, patientId: patientOwn.id, status: "CHECKED_IN", checkedInAt: at(360_000), queueNumber: 7001 })
    const sibAhead1 = await scopeEntry({ branchId: siblingQA.id, patientId: patientSib.id, status: "CHECKED_IN", checkedInAt: at(300_000), queueNumber: 7201 })
    const sibAhead2 = await scopeEntry({ branchId: siblingQA.id, patientId: patientSib.id, status: "CHECKED_IN", checkedInAt: at(240_000), queueNumber: 7202 })
    const sibToken = await scopeEntry({ branchId: siblingQA.id, patientId: patientSib.id, status: "CHECKED_IN", checkedInAt: at(180_000), queueNumber: 7203 })
    const ownAhead = await scopeEntry({ branchId: branchQA.id, patientId: patientOwn.id, status: "CHECKED_IN", checkedInAt: at(120_000), queueNumber: 7002 })
    const ownToken = await scopeEntry({ branchId: branchQA.id, patientId: patientOwn.id, status: "CHECKED_IN", checkedInAt: at(60_000), queueNumber: 7003 })
    // "Now serving" candidates — nowServing is `orderBy: calledAt desc`, so
    // the cross-clinic branch's is the most recent of the three globally.
    // A query that lost its branch filter returns 7301 for BOTH tokens.
    const ownCalled = await scopeEntry({ branchId: branchQA.id, patientId: patientOwn.id, status: "CALLED", checkedInAt: at(400_000), calledAt: at(30_000), queueNumber: 7101 })
    const sibCalled = await scopeEntry({ branchId: siblingQA.id, patientId: patientSib.id, status: "CALLED", checkedInAt: at(400_000), calledAt: at(20_000), queueNumber: 7204 })
    const crossCalled = await scopeEntry({ branchId: branchQB.id, patientId: patientCross.id, status: "CALLED", checkedInAt: at(400_000), calledAt: at(10_000), queueNumber: 7301 })
    return { ownVeryEarly, sibAhead1, sibAhead2, sibToken, ownAhead, ownToken, ownCalled, sibCalled, crossCalled }
  }

  it("getPatientStatusByToken counts only the token's OWN branch — a sibling branch's queue changes neither patientsAhead nor nowServing", async () => {
    const s = await seedTokenScenario()

    const status = await getPatientStatusByToken(s.ownToken.accessToken)
    expect(status).toBeTruthy()

    // Own branch's active entries ahead: ownVeryEarly, ownAhead → 2.
    // Across all three branches it would be 5. The exact number is itself
    // the positive control that the counter counts at all.
    expect(status!.patientsAhead).toBe(2)
    expect(status!.estimatedWaitMinutes).toBe(2 * 15)
    expect(status!.queueNumber).toBe(7003)

    expect(status!.nowServing).toBe(7101) // own branch's called entry
    expect(status!.nowServing).not.toBe(7204) // the sibling's
    expect(status!.nowServing).not.toBe(7301) // the other clinic's (the globally most-recent call)

    // Same clinic as the sibling, so only the branch half of the name can
    // distinguish them — which is exactly the identity that must be right.
    expect(status!.clinicName).toBe(`${clinicAName} – ${branchQA.name}`)
    expect(status!.clinicAddress).toBe(branchQA.address)

    // Nothing that names a person, and no chainable identifier, crosses.
    const serialized = JSON.stringify(status)
    expect(serialized).not.toContain("Sibsecret")
    expect(serialized).not.toContain("Crossclinic")
    expect(serialized).not.toContain("Ownside") // not even the caller's own name
    expect(serialized).not.toContain(patientOwn.id)
    expect(serialized).not.toContain(patientSib.id)
    expect(serialized).not.toContain(s.ownToken.accessToken)
    expect(serialized).not.toContain(s.sibToken.accessToken)

    // Falsifiability probe. `patientsAhead === 2` and `nowServing === 7101`
    // only mean something if the *unfiltered* versions of those two queries
    // would answer differently against this exact fixture. They do: run the
    // same computations here with the `branchId` filter widened to the
    // sibling (and, for nowServing, the other clinic too) and the answers
    // become 5 and 7301. So deleting either `branchId:` in
    // public-queue.ts:86/:94 turns the assertions above red — they are not
    // assertions a broken-but-empty query could also satisfy.
    const unfilteredActive = await superuserPrisma.queueEntry.findMany({
      where: {
        branchId: { in: [branchQA.id, siblingQA.id] },
        queueDate: scopeQueueDate(),
        status: { in: ["CHECKED_IN", "WAITING"] },
      },
      select: { id: true, priority: true, checkedInAt: true },
    })
    unfilteredActive.sort(compareQueueOrder)
    expect(unfilteredActive.findIndex((e) => e.id === s.ownToken.id)).toBe(5)
    expect(status!.patientsAhead).not.toBe(5)

    const unfilteredNowServing = await superuserPrisma.queueEntry.findFirst({
      where: {
        branchId: { in: [branchQA.id, siblingQA.id, branchQB.id] },
        queueDate: scopeQueueDate(),
        status: { in: ["CALLED", "IN_CONSULTATION"] },
      },
      orderBy: { calledAt: "desc" },
      select: { queueNumber: true },
    })
    expect(unfilteredNowServing?.queueNumber).toBe(7301)
    expect(status!.nowServing).not.toBe(unfilteredNowServing?.queueNumber)
  })

  it("getPatientStatusByToken still answers correctly for the SIBLING's own token — the master-key path works, it is just branch-confined", async () => {
    const s = await seedTokenScenario()

    const status = await getPatientStatusByToken(s.sibToken.accessToken)
    expect(status).toBeTruthy()

    // Sibling's own active entries ahead: sibAhead1, sibAhead2 → 2.
    // Across all branches sibToken sits third → 3.
    expect(status!.patientsAhead).toBe(2)
    expect(status!.queueNumber).toBe(7203)
    expect(status!.nowServing).toBe(7204)
    expect(status!.nowServing).not.toBe(7301)
    expect(status!.clinicName).toBe(`${clinicAName} – ${siblingQA.name}`)
    expect(status!.clinicAddress).toBe(siblingQA.address)
    expect(JSON.stringify(status)).not.toContain("Ownside")
  })

  it("getPublicDisplayState resolves two slugs under ONE clinic to genuinely separate queues, numbers only", async () => {
    const t = Date.now()
    const at = (msAgo: number) => new Date(t - msAgo)
    // The sibling's waiting entries are the earliest, so if the branch
    // filter vanished they would occupy the front of branchQA's `next`.
    await scopeEntry({ branchId: siblingQA.id, patientId: patientSib.id, status: "CHECKED_IN", checkedInAt: at(50_000), queueNumber: 7501 })
    await scopeEntry({ branchId: siblingQA.id, patientId: patientSib.id, status: "CHECKED_IN", checkedInAt: at(40_000), queueNumber: 7502 })
    await scopeEntry({ branchId: branchQA.id, patientId: patientOwn.id, status: "CHECKED_IN", checkedInAt: at(30_000), queueNumber: 7401 })
    await scopeEntry({ branchId: branchQA.id, patientId: patientOwn.id, status: "CHECKED_IN", checkedInAt: at(20_000), queueNumber: 7402 })
    await scopeEntry({ branchId: branchQB.id, patientId: patientCross.id, status: "CHECKED_IN", checkedInAt: at(10_000), queueNumber: 7601 })
    await scopeEntry({ branchId: branchQA.id, patientId: patientOwn.id, status: "CALLED", checkedInAt: at(60_000), calledAt: at(25_000), queueNumber: 7403 })
    await scopeEntry({ branchId: siblingQA.id, patientId: patientSib.id, status: "CALLED", checkedInAt: at(60_000), calledAt: at(5_000), queueNumber: 7503 })

    const qaState = await getPublicDisplayState(branchQA.slug)
    expect(qaState).toBeTruthy()
    expect(qaState!.next).toEqual([7401, 7402]) // positive control: its own numbers, in order
    expect(qaState!.next).not.toContain(7501)
    expect(qaState!.next).not.toContain(7502)
    expect(qaState!.next).not.toContain(7601)
    expect(qaState!.nowServing).toBe(7403)
    expect(qaState!.nowServing).not.toBe(7503)
    expect(qaState!.clinicName).toBe(`${clinicAName} – ${branchQA.name}`)

    const sibState = await getPublicDisplayState(siblingQA.slug)
    expect(sibState).toBeTruthy()
    expect(sibState!.next).toEqual([7501, 7502])
    expect(sibState!.next).not.toContain(7401)
    expect(sibState!.next).not.toContain(7402)
    expect(sibState!.nowServing).toBe(7503)
    // Same clinic, different branch — two distinct public identities.
    expect(sibState!.clinicName).toBe(`${clinicAName} – ${siblingQA.name}`)
    expect(sibState!.clinicName).not.toBe(qaState!.clinicName)

    // Falsifiability probe, as in the token test above: the same "next 3"
    // computed without the branch filter puts the sibling's numbers at the
    // front of the list, so `next === [7401, 7402]` is an assertion that
    // genuinely fails if `branchId` leaves public-queue.ts:43.
    const unfilteredUpcoming = await superuserPrisma.queueEntry.findMany({
      where: {
        branchId: { in: [branchQA.id, siblingQA.id] },
        queueDate: scopeQueueDate(),
        status: { in: ["CHECKED_IN", "WAITING"] },
      },
      select: { queueNumber: true, priority: true, checkedInAt: true },
    })
    unfilteredUpcoming.sort(compareQueueOrder)
    expect(unfilteredUpcoming.slice(0, 3).map((e) => e.queueNumber)).toEqual([7501, 7502, 7401])
    expect(qaState!.next).not.toEqual([7501, 7502, 7401])

    // §10: numbers only, on both.
    for (const state of [qaState, sibState]) {
      const serialized = JSON.stringify(state)
      expect(serialized).not.toContain("Ownside")
      expect(serialized).not.toContain("Sibsecret")
      expect(serialized).not.toContain("Crossclinic")
      expect(serialized).not.toContain(patientOwn.id)
      expect(serialized).not.toContain(patientSib.id)
    }
  })

  // ── queue-number allocation ─────────────────────────────────────────────

  it("nextQueueNumber counts per branch, not per clinic — two siblings do not share a counter", async () => {
    for (const n of [1, 2, 3]) {
      await scopeEntry({ branchId: branchQA.id, patientId: patientOwn.id, status: "BOOKED", checkedInAt: null, queueNumber: n, queueDate: ALLOC_DATE })
    }
    for (const n of [1, 2, 3, 4, 5, 6, 7]) {
      await scopeEntry({ branchId: siblingQA.id, patientId: patientSib.id, status: "BOOKED", checkedInAt: null, queueNumber: n, queueDate: ALLOC_DATE })
    }

    // Deliberately run through the RLS-bypassing client: with the database
    // layer taken out of the picture, only the app-layer `where` in
    // nextQueueNumber can be what confines the count.
    const forQA = await superuserPrisma.$transaction((tx) => nextQueueNumber(tx, branchQA.id, ALLOC_DATE))
    const forSibling = await superuserPrisma.$transaction((tx) => nextQueueNumber(tx, siblingQA.id, ALLOC_DATE))

    expect(forQA).toBe(4) // its own three rows — not 8, which is what a shared counter gives
    expect(forSibling).toBe(8) // positive control: the allocator does advance with row count
  })

  it("two sibling branches each start tomorrow's queue at 1 and increment independently", async () => {
    const book = (slug: string, lastName: string) =>
      createPublicBooking(slug, {
        firstName: "Booker",
        lastName,
        birthdate: "1980-02-02",
        sex: "FEMALE",
        phone: `0917${Math.floor(1000000 + Math.random() * 8999999)}`,
        address: "addr",
        emergencyContactName: "ec",
        emergencyContactPhone: "+63 917 000 0000",
        reasonForVisit: "Checkup",
        priority: false,
        preferredDate: "tomorrow",
        consent: true,
      })

    const qaFirst = await book(branchQA.slug, uniq("qa-one"))
    const sibFirst = await book(siblingQA.slug, uniq("sib-one"))
    expect(qaFirst.queueEntry.queueNumber).toBe(1)
    expect(sibFirst.queueEntry.queueNumber).toBe(1) // not 2 — separate counters

    const qaSecond = await book(branchQA.slug, uniq("qa-two"))
    const sibSecond = await book(siblingQA.slug, uniq("sib-two"))
    // The increment is the positive control: equality above is not a stuck counter.
    expect(qaSecond.queueEntry.queueNumber).toBe(2)
    expect(sibSecond.queueEntry.queueNumber).toBe(2)
  })

  // ── Postgres RLS backstop ───────────────────────────────────────────────

  it("RLS backstop: a sibling branch's queue entry is invisible to branchQA's session, independent of any app-layer where-clause", async () => {
    const sibling = await scopeEntry({ branchId: siblingQA.id, patientId: patientSib.id, status: "CHECKED_IN" })

    const hidden = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.role', ${Role.FRONT_DESK}, true)`
      await tx.$executeRaw`SELECT set_config('app.user_id', ${frontDeskA.id}, true)`
      await tx.$executeRaw`SELECT set_config('app.branch_id', ${branchQA.id}, true)`
      // deliberately unfiltered by branch — only the policy can hide this
      return tx.queueEntry.findMany({ where: { id: sibling.id } })
    })
    expect(hidden).toHaveLength(0)

    // Positive control: identical query, identical code path, only
    // app.branch_id differs — so this proves the policy is keyed on the GUC
    // rather than simply hiding everything.
    const visible = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.role', ${Role.FRONT_DESK}, true)`
      await tx.$executeRaw`SELECT set_config('app.user_id', ${frontDeskA.id}, true)`
      await tx.$executeRaw`SELECT set_config('app.branch_id', ${siblingQA.id}, true)`
      return tx.queueEntry.findMany({ where: { id: sibling.id } })
    })
    expect(visible).toHaveLength(1)
  })

  it("RLS backstop: another clinic's queue entry is invisible too (the older cross-clinic boundary still holds)", async () => {
    const cross = await scopeEntry({ branchId: branchQB.id, patientId: patientCross.id, status: "CHECKED_IN" })
    const own = await scopeEntry({ branchId: branchQA.id, patientId: patientOwn.id, status: "CHECKED_IN" })

    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.role', ${Role.FRONT_DESK}, true)`
      await tx.$executeRaw`SELECT set_config('app.user_id', ${frontDeskA.id}, true)`
      await tx.$executeRaw`SELECT set_config('app.branch_id', ${branchQA.id}, true)`
      return tx.queueEntry.findMany({ where: { id: { in: [cross.id, own.id] } } })
    })
    // Positive control folded into the same query: our own row comes back
    // from the very same unfiltered SELECT that fails to return theirs.
    expect(rows.map((r) => r.id)).toEqual([own.id])
  })

  it("RLS backstop: branchQA's session cannot UPDATE a sibling branch's queue entry", async () => {
    const sibling = await scopeEntry({ branchId: siblingQA.id, patientId: patientSib.id, status: "CHECKED_IN" })
    const before = await reread(sibling.id)

    const blocked = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.role', ${Role.FRONT_DESK}, true)`
      await tx.$executeRaw`SELECT set_config('app.user_id', ${frontDeskA.id}, true)`
      await tx.$executeRaw`SELECT set_config('app.branch_id', ${branchQA.id}, true)`
      return tx.queueEntry.updateMany({ where: { id: sibling.id }, data: { status: "NO_SHOW" } })
    })
    expect(blocked.count).toBe(0)
    expect(await reread(sibling.id)).toEqual(before)

    // Positive control: same statement, same row, only the branch GUC moves.
    const allowed = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.role', ${Role.FRONT_DESK}, true)`
      await tx.$executeRaw`SELECT set_config('app.user_id', ${frontDeskA.id}, true)`
      await tx.$executeRaw`SELECT set_config('app.branch_id', ${siblingQA.id}, true)`
      return tx.queueEntry.updateMany({ where: { id: sibling.id }, data: { status: "NO_SHOW" } })
    })
    expect(allowed.count).toBe(1)
    expect((await reread(sibling.id)).status).toBe("NO_SHOW")
  })

  it("RLS backstop: branchQA's session cannot INSERT a queue entry into a sibling branch", async () => {
    const rejected = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.role', ${Role.FRONT_DESK}, true)`
      await tx.$executeRaw`SELECT set_config('app.user_id', ${frontDeskA.id}, true)`
      await tx.$executeRaw`SELECT set_config('app.branch_id', ${branchQA.id}, true)`
      return tx.queueEntry.create({
        data: {
          branchId: siblingQA.id, // forged — the caller's session is branchQA
          patientId: patientSib.id,
          queueNumber: 8801,
          queueDate: scopeQueueDate(),
          status: "CHECKED_IN",
          source: QueueSource.WALK_IN,
          checkedInAt: new Date(),
          accessToken: uniq("rls-insert-denied"),
        },
      })
    })
    await expect(rejected).rejects.toThrow(/row-level security/i)
    expect(await superuserPrisma.queueEntry.findFirst({ where: { queueNumber: 8801, branchId: siblingQA.id } })).toBeNull()

    // Positive control: byte-for-byte the same insert into the caller's own
    // branch goes through, so the rejection above is the policy talking and
    // not a broken statement.
    const created = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.role', ${Role.FRONT_DESK}, true)`
      await tx.$executeRaw`SELECT set_config('app.user_id', ${frontDeskA.id}, true)`
      await tx.$executeRaw`SELECT set_config('app.branch_id', ${branchQA.id}, true)`
      return tx.queueEntry.create({
        data: {
          branchId: branchQA.id,
          patientId: patientOwn.id,
          queueNumber: 8802,
          queueDate: scopeQueueDate(),
          status: "CHECKED_IN",
          source: QueueSource.WALK_IN,
          checkedInAt: new Date(),
          accessToken: uniq("rls-insert-allowed"),
        },
      })
    })
    expect(created.branchId).toBe(branchQA.id)
  })
})
