import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { Role, Sex, type Prisma } from "@prisma/client"
import { superuserPrisma } from "@/lib/test/superuser-prisma"
import { prisma } from "@/lib/db/prisma"
import { getBranchReport } from "@/lib/queries/reports/clinic"
import { getHoldingConsolidatedReport } from "@/lib/queries/reports/holding"
import { submitRemittance, getMyRemittanceStatus, listPendingRemittances, confirmRemittance } from "@/lib/queries/remittance"
import { createExpense, listExpenses } from "@/lib/queries/expenses"
import { listMyCollectionsToday } from "@/lib/queries/payments"
import { ForbiddenError } from "@/lib/permissions/errors"
import { todayAsQueueDate } from "@/lib/queries/queue"
import type { AbilitySubject } from "@/lib/permissions/ability"

/**
 * M6's accept bar (§12): "holding admin sees three branches with a
 * combined P&L whose per-branch revenue totals reconcile exactly to the
 * sum of payment rows, and a remittance variance displays correctly."
 */
describe("reports and reconciliation", () => {
  let holdingId: string
  let branches: { id: string; name: string; timezone: string }[]
  let clinicNames: string[]
  let holdingAdmin: AbilitySubject
  let clinicAdmins: AbilitySubject[]
  let frontDeskUsers: AbilitySubject[]
  let doctors: { id: string; user: AbilitySubject }[]
  let patients: string[][]

  async function payment(branchId: string, patientId: string, collectorUserId: string, amountCentavos: number, consultationId?: string) {
    return superuserPrisma.payment.create({
      data: { branchId, patientId, amount: amountCentavos, collectedByUserId: collectorUserId, consultationId },
    })
  }

  // ── helpers for the branch-isolation tests below ──────────────────────
  //
  // Every literal these generate carries a "report-iso" prefix: other test
  // files run against this same local database, and access tokens / slugs /
  // emails are uniquely indexed.
  const isoPrefix = "report-iso"
  let isoCounter = 0
  const uniqueSuffix = () => `${isoPrefix}-${Date.now()}-${(isoCounter += 1)}`

  /**
   * The afterEach below deletes queue entries but *not* consultations, and
   * consultations hold an FK to queue_entries — so any test that needs a
   * consultation (the only way `revenueByDoctor` gets a real doctor name)
   * has to unwind its own consultations before that hook runs, or the
   * queueEntry.deleteMany will fail and cascade into every later test.
   * Tests below do that in a `finally`.
   */
  const seededVisits: { queueEntryId: string; consultationId: string }[] = []

  async function visitWithConsultation(branchId: string, patientId: string, doctorId: string, queueNumber: number, timezone: string) {
    const entry = await superuserPrisma.queueEntry.create({
      data: {
        branchId,
        patientId,
        doctorId,
        queueNumber,
        queueDate: todayAsQueueDate(timezone),
        status: "COMPLETED",
        source: "WALK_IN",
        checkedInAt: new Date(),
        accessToken: `t-${uniqueSuffix()}`,
      },
    })
    const consultation = await superuserPrisma.consultation.create({
      data: { queueEntryId: entry.id, patientId, doctorId, branchId, chiefComplaint: "isolation fixture" },
    })
    const seeded = { queueEntryId: entry.id, consultationId: consultation.id }
    seededVisits.push(seeded)
    return seeded
  }

  async function clearSeededVisits() {
    if (seededVisits.length === 0) return
    const consultationIds = seededVisits.map((v) => v.consultationId)
    const queueEntryIds = seededVisits.map((v) => v.queueEntryId)
    seededVisits.length = 0
    await superuserPrisma.payment.deleteMany({ where: { consultationId: { in: consultationIds } } })
    await superuserPrisma.medicineDispensed.deleteMany({ where: { consultationId: { in: consultationIds } } })
    await superuserPrisma.consultation.deleteMany({ where: { id: { in: consultationIds } } })
    await superuserPrisma.queueEntry.deleteMany({ where: { id: { in: queueEntryIds } } })
  }

  /** Runs `fn` with the RLS session GUCs a real request would carry, on the RLS-enforced app client. */
  function asSession<T>(user: AbilitySubject, branchId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.role', ${user.role}, true)`
      await tx.$executeRaw`SELECT set_config('app.user_id', ${user.id}, true)`
      await tx.$executeRaw`SELECT set_config('app.branch_id', ${branchId}, true)`
      return fn(tx)
    })
  }

  function remittanceRow(branchId: string, userId: string, amount: number) {
    return superuserPrisma.remittance.create({
      data: {
        branchId,
        userId,
        shiftDate: todayAsQueueDate("Asia/Manila"),
        expectedAmount: amount,
        actualAmount: amount,
        variance: 0,
      },
    })
  }

  function expenseRow(branchId: string, recordedByUserId: string, category: string, amount: number) {
    return superuserPrisma.expense.create({
      data: { branchId, category, amount, expenseDate: todayAsQueueDate("Asia/Manila"), recordedByUserId },
    })
  }

  beforeAll(async () => {
    const holding = await superuserPrisma.holdingCompany.create({ data: { name: "Report Test Holding" } })
    holdingId = holding.id

    const holdingAdminUser = await superuserPrisma.user.create({
      data: { name: "Owner", email: `owner-report-${Date.now()}@test.local`, passwordHash: "x", role: Role.HOLDING_ADMIN, holdingCompanyId: holding.id },
    })
    holdingAdmin = { id: holdingAdminUser.id, role: Role.HOLDING_ADMIN, branchId: null, holdingCompanyId: holding.id }

    branches = []
    clinicAdmins = []
    frontDeskUsers = []
    doctors = []
    patients = []

    // Branches 0 and 1 deliberately share one clinic, branch 2 sits under
    // another — the consolidated report groups by branch but labels each
    // with its parent clinic, so a flat 3-clinics/3-branches fixture would
    // never catch a wrong join.
    const clinicOne = await superuserPrisma.clinic.create({ data: { holdingCompanyId: holding.id, name: `Report Clinic One ${Date.now()}` } })
    const clinicTwo = await superuserPrisma.clinic.create({ data: { holdingCompanyId: holding.id, name: `Report Clinic Two ${Date.now()}` } })
    clinicNames = [clinicOne.name, clinicOne.name, clinicTwo.name]

    for (let i = 0; i < 3; i++) {
      const branch = await superuserPrisma.branch.create({
        data: {
          clinicId: i < 2 ? clinicOne.id : clinicTwo.id,
          name: `Report Branch ${i}`,
          slug: `report-branch-${i}-${Date.now()}`,
          address: "1 Test St",
          city: "Test City",
          phone: "0000",
          timezone: "Asia/Manila",
          operatingHours: {},
        },
      })
      branches.push({ id: branch.id, name: branch.name, timezone: branch.timezone })

      const adminUser = await superuserPrisma.user.create({
        data: { branchId: branch.id, name: `Admin ${i}`, email: `admin-report-${i}-${Date.now()}@test.local`, passwordHash: "x", role: Role.CLINIC_ADMIN },
      })
      clinicAdmins.push({ id: adminUser.id, role: Role.CLINIC_ADMIN, branchId: branch.id, holdingCompanyId: null })

      const fdUser = await superuserPrisma.user.create({
        data: { branchId: branch.id, name: `FrontDesk ${i}`, email: `fd-report-${i}-${Date.now()}@test.local`, passwordHash: "x", role: Role.FRONT_DESK },
      })
      frontDeskUsers.push({ id: fdUser.id, role: Role.FRONT_DESK, branchId: branch.id, holdingCompanyId: null })

      const docUser = await superuserPrisma.user.create({
        data: { branchId: branch.id, name: `Doc ${i}`, email: `doc-report-${i}-${Date.now()}@test.local`, passwordHash: "x", role: Role.DOCTOR },
      })
      const doctor = await superuserPrisma.doctor.create({
        data: { userId: docUser.id, branchId: branch.id, licenseNumber: `R${i}`, consultationFee: 50000 },
      })
      doctors.push({ id: doctor.id, user: { id: docUser.id, role: Role.DOCTOR, branchId: branch.id, holdingCompanyId: null } })

      const branchPatients: string[] = []
      for (let j = 0; j < 2; j++) {
        const patient = await superuserPrisma.patient.create({
          data: {
            branchId: branch.id,
            firstName: `P${i}${j}`,
            lastName: "Test",
            birthdate: new Date("1990-01-01"),
            sex: Sex.FEMALE,
            phone: `+63 917 ${i}${j}0 000${j}`,
            address: "addr",
            emergencyContactName: "ec",
            emergencyContactPhone: "000",
          },
        })
        branchPatients.push(patient.id)
      }
      patients.push(branchPatients)
    }
  })

  afterEach(async () => {
    for (const branch of branches) {
      await superuserPrisma.auditLog.deleteMany({ where: { branchId: branch.id } })
      await superuserPrisma.remittance.deleteMany({ where: { branchId: branch.id } })
      await superuserPrisma.expense.deleteMany({ where: { branchId: branch.id } })
      await superuserPrisma.payment.deleteMany({ where: { branchId: branch.id } })
      await superuserPrisma.queueEntry.deleteMany({ where: { branchId: branch.id } })
    }
  })

  afterAll(async () => {
    for (const branch of branches) {
      await superuserPrisma.patient.deleteMany({ where: { branchId: branch.id } })
      await superuserPrisma.doctor.deleteMany({ where: { branchId: branch.id } })
      await superuserPrisma.user.deleteMany({ where: { branchId: branch.id } })
      await superuserPrisma.branch.delete({ where: { id: branch.id } })
    }
    await superuserPrisma.clinic.deleteMany({ where: { holdingCompanyId: holdingId } })
    await superuserPrisma.user.delete({ where: { id: holdingAdmin.id } })
    await superuserPrisma.holdingCompany.delete({ where: { id: holdingId } })
    await superuserPrisma.$disconnect()
    await prisma.$disconnect()
  })

  it("a branch's revenueTotal is exactly the sum of its own payment rows in range", async () => {
    const branch = branches[0]
    await payment(branch.id, patients[0][0], frontDeskUsers[0].id, 50000)
    await payment(branch.id, patients[0][1], frontDeskUsers[0].id, 30000)
    // a payment outside the default 30-day range shouldn't count
    const oldPayment = await payment(branch.id, patients[0][0], frontDeskUsers[0].id, 99999)
    await superuserPrisma.payment.update({ where: { id: oldPayment.id }, data: { receivedAt: new Date(Date.now() - 60 * 86_400_000) } })

    const report = await getBranchReport(clinicAdmins[0], {})
    expect(report.revenueTotal).toBe(80000)
  })

  it("holding consolidated report: per-branch revenue reconciles exactly to the sum of payment rows, across three branches", async () => {
    await payment(branches[0].id, patients[0][0], frontDeskUsers[0].id, 50000)
    await payment(branches[0].id, patients[0][1], frontDeskUsers[0].id, 25000)
    await payment(branches[1].id, patients[1][0], frontDeskUsers[1].id, 70000)
    await payment(branches[2].id, patients[2][0], frontDeskUsers[2].id, 10000)
    await payment(branches[2].id, patients[2][1], frontDeskUsers[2].id, 15000)

    await createExpense(clinicAdmins[0], { category: "Rent", amount: 20000, expenseDate: new Date().toISOString() })
    await createExpense(clinicAdmins[1], { category: "Utilities", amount: 5000, expenseDate: new Date().toISOString() })

    const report = await getHoldingConsolidatedReport(holdingAdmin, {})
    expect(report.branches).toHaveLength(3)

    for (const branchSummary of report.branches) {
      const actualSum = await superuserPrisma.payment.aggregate({
        where: { branchId: branchSummary.branchId, receivedAt: { gte: new Date(Date.now() - 40 * 86_400_000) } },
        _sum: { amount: true },
      })
      expect(branchSummary.revenueTotal).toBe(actualSum._sum.amount ?? 0)
    }

    const c0 = report.branches.find((c) => c.branchId === branches[0].id)!
    const c1 = report.branches.find((c) => c.branchId === branches[1].id)!
    const c2 = report.branches.find((c) => c.branchId === branches[2].id)!
    expect(c0.revenueTotal).toBe(75000)
    expect(c0.expensesTotal).toBe(20000)
    expect(c0.net).toBe(55000)
    expect(c1.revenueTotal).toBe(70000)
    expect(c1.expensesTotal).toBe(5000)
    expect(c2.revenueTotal).toBe(25000)

    expect(report.consolidated.revenueTotal).toBe(75000 + 70000 + 25000)
    expect(report.consolidated.expensesTotal).toBe(25000)
    expect(report.consolidated.net).toBe(report.consolidated.revenueTotal - 25000)

    // ranking by revenue: branch 0 (75000) > branch 1 (70000) > branch 2 (25000)
    expect(report.rankingByRevenue.map((c) => c.branchId)).toEqual([branches[0].id, branches[1].id, branches[2].id])
  })

  it("labels each branch summary with its own parent clinic, and keeps sibling branches separate", async () => {
    await payment(branches[0].id, patients[0][0], frontDeskUsers[0].id, 40000)
    await payment(branches[1].id, patients[1][0], frontDeskUsers[1].id, 60000)

    const report = await getHoldingConsolidatedReport(holdingAdmin, {})
    for (const [i, branch] of branches.entries()) {
      const summary = report.branches.find((s) => s.branchId === branch.id)!
      expect(summary.branchName).toBe(branch.name)
      expect(summary.clinicName).toBe(clinicNames[i])
    }

    // Branches 0 and 1 share a clinic — the report must still bill them
    // separately rather than rolling them into one clinic-level row.
    const [b0, b1] = [branches[0], branches[1]].map((b) => report.branches.find((s) => s.branchId === b.id)!)
    expect(b0.clinicName).toBe(b1.clinicName)
    expect(b0.revenueTotal).toBe(40000)
    expect(b1.revenueTotal).toBe(60000)
  })

  it("a non-holding-admin can't reach the consolidated report", async () => {
    await expect(getHoldingConsolidatedReport(clinicAdmins[0], {})).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("remittance variance displays correctly, both for a shortfall and an exact match", async () => {
    const fd = frontDeskUsers[0]
    const branch = branches[0]
    await payment(branch.id, patients[0][0], fd.id, 50000)
    await payment(branch.id, patients[0][1], fd.id, 30000)

    const status = await getMyRemittanceStatus(fd)
    expect(status.expectedAmount).toBe(80000)
    expect(status.alreadySubmitted).toBeNull()

    // collector hands over less cash than the system shows
    await submitRemittance(fd, 75000, "short by 500 pesos")

    const remittance = await superuserPrisma.remittance.findFirstOrThrow({ where: { branchId: branch.id, userId: fd.id } })
    expect(remittance.expectedAmount).toBe(80000)
    expect(remittance.actualAmount).toBe(75000)
    expect(remittance.variance).toBe(-5000)

    const statusAfter = await getMyRemittanceStatus(fd)
    expect(statusAfter.alreadySubmitted?.variance).toBe(-5000)
    expect(statusAfter.alreadySubmitted?.confirmed).toBe(false)

    const pending = await listPendingRemittances(clinicAdmins[0])
    expect(pending.find((r) => r.id === remittance.id)?.variance).toBe(-5000)

    await confirmRemittance(clinicAdmins[0], remittance.id)
    const pendingAfter = await listPendingRemittances(clinicAdmins[0])
    expect(pendingAfter.find((r) => r.id === remittance.id)).toBeUndefined()
  })

  it("the expected amount is always computed server-side from real payments, never trusted from the caller", async () => {
    // submitRemittance only ever takes the actual (handed-over) amount as
    // input — there's no expectedAmount parameter to pass a fabricated
    // value through in the first place.
    const fd = frontDeskUsers[1]
    await payment(branches[1].id, patients[1][0], fd.id, 12345)
    await submitRemittance(fd, 12345)
    const remittance = await superuserPrisma.remittance.findFirstOrThrow({ where: { userId: fd.id } })
    expect(remittance.expectedAmount).toBe(12345)
    expect(remittance.variance).toBe(0)
  })

  it("only a clinic admin can confirm a remittance", async () => {
    const fd = frontDeskUsers[2]
    await payment(branches[2].id, patients[2][0], fd.id, 1000)
    await submitRemittance(fd, 1000)
    const remittance = await superuserPrisma.remittance.findFirstOrThrow({ where: { userId: fd.id } })
    await expect(confirmRemittance(fd, remittance.id)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("expenses feed directly into the branch report's net figure", async () => {
    const branch = branches[0]
    await payment(branch.id, patients[0][0], frontDeskUsers[0].id, 100000)
    await createExpense(clinicAdmins[0], { category: "Supplies", description: "Gloves", amount: 15000, expenseDate: new Date().toISOString() })

    const { expenses } = await listExpenses(clinicAdmins[0], {})
    expect(expenses.some((e) => e.category === "Supplies" && e.amount === 15000)).toBe(true)

    const report = await getBranchReport(clinicAdmins[0], {})
    expect(report.revenueTotal).toBe(100000)
    expect(report.expensesTotal).toBe(15000)
    expect(report.net).toBe(85000)
  })

  it("visit counting, new-vs-returning, and no-show rate are correct", async () => {
    const branch = branches[1]
    const timezone = branch.timezone
    const queueDate = todayAsQueueDate(timezone)

    // patients[1][0]: a genuinely new patient, completed visit
    await superuserPrisma.queueEntry.create({
      data: {
        branchId: branch.id, patientId: patients[1][0], queueNumber: 5001, queueDate, status: "COMPLETED",
        source: "WALK_IN", checkedInAt: new Date(), accessToken: `t-${Date.now()}-1`,
      },
    })
    // patients[1][1]: has a prior visit before the range, then a no-show within range
    await superuserPrisma.queueEntry.create({
      data: {
        branchId: branch.id, patientId: patients[1][1], queueNumber: 5002, queueDate,
        status: "COMPLETED", source: "WALK_IN",
        checkedInAt: new Date(Date.now() - 45 * 86_400_000), accessToken: `t-${Date.now()}-2`,
      },
    })
    await superuserPrisma.queueEntry.create({
      data: {
        branchId: branch.id, patientId: patients[1][1], queueNumber: 5003, queueDate,
        status: "NO_SHOW", source: "WALK_IN", checkedInAt: new Date(), accessToken: `t-${Date.now()}-3`,
      },
    })

    const report = await getBranchReport(clinicAdmins[1], {})
    expect(report.visitCount).toBe(2) // the two within-range checked-in entries
    expect(report.newPatientCount).toBe(1) // patients[1][0]
    expect(report.returningPatientCount).toBe(1) // patients[1][1], had an earlier visit
    expect(report.noShowRate).toBe(0.5) // 1 no-show out of 2 in-range visits
  })

  // ───────────────────────────────────────────────────────────────────────
  // Branch isolation between SIBLINGS UNDER ONE CLINIC.
  //
  // branches[0] and branches[1] share clinicOne; branches[2] sits under
  // clinicTwo. Every test above that funds a branch funds exactly one, so
  // it would pass just as well against a query with no branchId term at
  // all. These fund the sibling too — that live, in-range, same-clinic
  // money is the negative control, and each test also asserts the caller's
  // own equivalent row is still there so a lockdown that returned nothing
  // couldn't satisfy it either.
  // ───────────────────────────────────────────────────────────────────────

  it("getBranchReport's revenue excludes a sibling branch's live money under the same clinic", async () => {
    try {
      const ownVisit = await visitWithConsultation(branches[0].id, patients[0][0], doctors[0].id, 7101, branches[0].timezone)
      const siblingVisit = await visitWithConsultation(branches[1].id, patients[1][0], doctors[1].id, 7102, branches[1].timezone)

      await payment(branches[0].id, patients[0][0], frontDeskUsers[0].id, 50000, ownVisit.consultationId)
      await payment(branches[0].id, patients[0][1], frontDeskUsers[0].id, 30000)
      // The sibling's money: same clinic, same range, same instant.
      await payment(branches[1].id, patients[1][0], frontDeskUsers[1].id, 777000, siblingVisit.consultationId)

      const report = await getBranchReport(clinicAdmins[0], {})
      expect(report.revenueTotal).toBe(80000)
      expect(report.dailyRevenue.reduce((sum, d) => sum + d.amount, 0)).toBe(80000)

      const doctorNames = report.revenueByDoctor.map((r) => r.doctorName)
      // positive control — branch 0's own doctor is attributed, with the right amount
      expect(doctorNames).toContain("Doc 0")
      expect(report.revenueByDoctor.find((r) => r.doctorName === "Doc 0")?.amount).toBe(50000)
      // the sibling branch's doctor must not appear at all
      expect(doctorNames).not.toContain("Doc 1")
      expect(report.revenueByDoctor.every((r) => r.amount !== 777000)).toBe(true)
    } finally {
      await clearSeededVisits()
    }
  })

  it("getBranchReport's revenue excludes both a sibling branch and another clinic's branch at once", async () => {
    await payment(branches[0].id, patients[0][0], frontDeskUsers[0].id, 20000)
    await payment(branches[1].id, patients[1][0], frontDeskUsers[1].id, 500000) // sibling, same clinic
    await payment(branches[2].id, patients[2][0], frontDeskUsers[2].id, 900000) // other clinic

    const report = await getBranchReport(clinicAdmins[0], {})
    expect(report.revenueTotal).toBe(20000)
    expect(report.dailyRevenue.reduce((sum, d) => sum + d.amount, 0)).toBe(20000)

    // positive control: the same call, from the sibling's own admin, sees the
    // sibling's money and nothing else — so the assertion above isn't being
    // satisfied by a report that simply reports nothing.
    const siblingReport = await getBranchReport(clinicAdmins[1], {})
    expect(siblingReport.revenueTotal).toBe(500000)
  })

  it("a patient's visit history in a sibling branch doesn't reclassify them as returning", async () => {
    const timezone = branches[0].timezone
    const queueDate = todayAsQueueDate(timezone)
    const older = new Date(Date.now() - 45 * 86_400_000)

    // patients[0][0]: first-ever visit *at branch 0* is inside the range …
    await superuserPrisma.queueEntry.create({
      data: {
        branchId: branches[0].id, patientId: patients[0][0], queueNumber: 7201, queueDate, status: "COMPLETED",
        source: "WALK_IN", checkedInAt: new Date(), accessToken: `t-${uniqueSuffix()}`,
      },
    })
    // … but the same person has an older visit recorded under the SIBLING
    // branch. reports/clinic.ts:65 must not count that as prior history.
    await superuserPrisma.queueEntry.create({
      data: {
        branchId: branches[1].id, patientId: patients[0][0], queueNumber: 7202, queueDate, status: "COMPLETED",
        source: "WALK_IN", checkedInAt: older, accessToken: `t-${uniqueSuffix()}`,
      },
    })
    // positive control: patients[0][1] is genuinely returning *within branch 0*,
    // so the classifier demonstrably still can label someone "returning".
    await superuserPrisma.queueEntry.create({
      data: {
        branchId: branches[0].id, patientId: patients[0][1], queueNumber: 7203, queueDate, status: "COMPLETED",
        source: "WALK_IN", checkedInAt: older, accessToken: `t-${uniqueSuffix()}`,
      },
    })
    await superuserPrisma.queueEntry.create({
      data: {
        branchId: branches[0].id, patientId: patients[0][1], queueNumber: 7204, queueDate, status: "COMPLETED",
        source: "WALK_IN", checkedInAt: new Date(), accessToken: `t-${uniqueSuffix()}`,
      },
    })

    const report = await getBranchReport(clinicAdmins[0], {})
    expect(report.visitCount).toBe(2)
    expect(report.newPatientCount).toBe(1) // patients[0][0] — sibling history doesn't count
    expect(report.returningPatientCount).toBe(1) // patients[0][1] — own-branch history does
  })

  it("listExpenses returns only the caller's branch, not a sibling's under the same clinic", async () => {
    await createExpense(clinicAdmins[0], { category: `${isoPrefix}-own`, amount: 11000, expenseDate: new Date().toISOString() })
    await createExpense(clinicAdmins[1], { category: `${isoPrefix}-sibling`, amount: 22000, expenseDate: new Date().toISOString() })

    const { expenses } = await listExpenses(clinicAdmins[0], {})
    const categories = expenses.map((e) => e.category)
    expect(categories).toContain(`${isoPrefix}-own`) // positive control
    expect(categories).not.toContain(`${isoPrefix}-sibling`)
    expect(expenses.every((e) => e.amount !== 22000)).toBe(true)

    // and the reverse direction, so neither side is simply empty
    const siblingSide = await listExpenses(clinicAdmins[1], {})
    expect(siblingSide.expenses.map((e) => e.category)).toEqual([`${isoPrefix}-sibling`])
  })

  it("listMyCollectionsToday ignores a sibling-branch payment credited to the same collector id", async () => {
    const fd = frontDeskUsers[0]
    await payment(branches[0].id, patients[0][0], fd.id, 45000)
    // Same collectedByUserId, sibling branch — the app itself would never
    // write this row, hence superuserPrisma. `collectedByUserId = fd.id`
    // matches BOTH rows, so only the branchId term can exclude it.
    await superuserPrisma.payment.create({
      data: { branchId: branches[1].id, patientId: patients[1][0], amount: 666000, collectedByUserId: fd.id },
    })

    const { entries, total } = await listMyCollectionsToday(fd)
    expect(entries).toHaveLength(1) // positive control: the caller's own row is present
    expect(entries[0].amount).toBe(45000)
    expect(total).toBe(45000)
  })

  it("getMyRemittanceStatus's expectedAmount ignores a sibling-branch payment credited to the same collector", async () => {
    const fd = frontDeskUsers[0]
    await payment(branches[0].id, patients[0][0], fd.id, 45000)
    await superuserPrisma.payment.create({
      data: { branchId: branches[1].id, patientId: patients[1][0], amount: 666000, collectedByUserId: fd.id },
    })

    // A leak here doesn't just disclose the sibling's revenue — it invents a
    // 6,660-peso cash shortfall for this collector.
    const status = await getMyRemittanceStatus(fd)
    expect(status.expectedAmount).toBe(45000)
  })

  it("getMyRemittanceStatus doesn't surface a sibling branch's remittance for the same user and shift date", async () => {
    const fd = frontDeskUsers[0]
    await payment(branches[0].id, patients[0][0], fd.id, 45000)
    const siblingRemittance = await remittanceRow(branches[1].id, fd.id, 666000)

    const before = await getMyRemittanceStatus(fd)
    expect(before.alreadySubmitted).toBeNull()

    // positive control: the caller's OWN remittance for that same shift does surface
    await submitRemittance(fd, 45000)
    const after = await getMyRemittanceStatus(fd)
    expect(after.alreadySubmitted).not.toBeNull()
    expect(after.alreadySubmitted?.actualAmount).toBe(45000)
    expect(after.alreadySubmitted?.id).not.toBe(siblingRemittance.id)
    const own = await superuserPrisma.remittance.findFirstOrThrow({ where: { branchId: branches[0].id, userId: fd.id } })
    expect(after.alreadySubmitted?.id).toBe(own.id)
  })

  it("listPendingRemittances excludes a sibling branch's pending remittance", async () => {
    const own = await remittanceRow(branches[0].id, frontDeskUsers[0].id, 50000)
    const sibling = await remittanceRow(branches[1].id, frontDeskUsers[1].id, 60000)

    const pending = await listPendingRemittances(clinicAdmins[0])
    const ids = pending.map((r) => r.id)
    expect(ids).toContain(own.id) // positive control
    expect(ids).not.toContain(sibling.id)

    // the sibling's own admin sees the mirror image
    const siblingPending = await listPendingRemittances(clinicAdmins[1])
    expect(siblingPending.map((r) => r.id)).toEqual([sibling.id])
  })

  it("confirmRemittance 403s on a sibling branch's remittance, and the row stays unconfirmed", async () => {
    const sibling = await remittanceRow(branches[1].id, frontDeskUsers[1].id, 60000)

    await expect(confirmRemittance(clinicAdmins[0], sibling.id)).rejects.toBeInstanceOf(ForbiddenError)
    const afterDenial = await superuserPrisma.remittance.findUniqueOrThrow({ where: { id: sibling.id } })
    expect(afterDenial.confirmedByUserId).toBeNull()

    // positive control: the very same row, the very same call, confirmed by
    // the admin who actually owns that branch — so the rejection above is
    // about the branch, not about the row being unconfirmable.
    await confirmRemittance(clinicAdmins[1], sibling.id)
    const afterConfirm = await superuserPrisma.remittance.findUniqueOrThrow({ where: { id: sibling.id } })
    expect(afterConfirm.confirmedByUserId).toBe(clinicAdmins[1].id)
  })

  it("confirmRemittance 403s on another clinic's remittance, and the row stays unconfirmed", async () => {
    const foreign = await remittanceRow(branches[2].id, frontDeskUsers[2].id, 70000)

    await expect(confirmRemittance(clinicAdmins[0], foreign.id)).rejects.toBeInstanceOf(ForbiddenError)
    const afterDenial = await superuserPrisma.remittance.findUniqueOrThrow({ where: { id: foreign.id } })
    expect(afterDenial.confirmedByUserId).toBeNull()

    await confirmRemittance(clinicAdmins[2], foreign.id) // positive control
    const afterConfirm = await superuserPrisma.remittance.findUniqueOrThrow({ where: { id: foreign.id } })
    expect(afterConfirm.confirmedByUserId).toBe(clinicAdmins[2].id)
  })

  it("getHoldingConsolidatedReport is bounded to the caller's own holding company", async () => {
    const suffix = uniqueSuffix()
    const otherHolding = await superuserPrisma.holdingCompany.create({ data: { name: `Report Test Holding Two ${suffix}` } })
    let otherBranchId: string | null = null
    try {
      const otherClinic = await superuserPrisma.clinic.create({
        data: { holdingCompanyId: otherHolding.id, name: `Report Other Clinic ${suffix}` },
      })
      const otherBranch = await superuserPrisma.branch.create({
        data: {
          clinicId: otherClinic.id,
          name: "Report Other Branch",
          slug: `report-other-branch-${suffix}`,
          address: "9 Test St",
          city: "Test City",
          phone: "0000",
          timezone: "Asia/Manila",
          operatingHours: {},
        },
      })
      otherBranchId = otherBranch.id
      const otherUser = await superuserPrisma.user.create({
        data: { branchId: otherBranch.id, name: "Other FD", email: `fd-${suffix}@test.local`, passwordHash: "x", role: Role.FRONT_DESK },
      })
      const otherPatient = await superuserPrisma.patient.create({
        data: {
          branchId: otherBranch.id,
          firstName: "Other",
          lastName: "Holding",
          birthdate: new Date("1990-01-01"),
          sex: Sex.FEMALE,
          phone: "+63 917 999 0000",
          address: "addr",
          emergencyContactName: "ec",
          emergencyContactPhone: "000",
        },
      })
      await payment(otherBranch.id, otherPatient.id, otherUser.id, 888000)
      await payment(branches[0].id, patients[0][0], frontDeskUsers[0].id, 30000)

      const report = await getHoldingConsolidatedReport(holdingAdmin, {})
      const branchIds = report.branches.map((b) => b.branchId)
      expect(branchIds).toContain(branches[0].id) // positive control
      expect(branchIds).not.toContain(otherBranch.id)
      expect(report.branches).toHaveLength(3)
      expect(report.consolidated.revenueTotal).toBe(30000)
    } finally {
      if (otherBranchId) {
        await superuserPrisma.payment.deleteMany({ where: { branchId: otherBranchId } })
        await superuserPrisma.patient.deleteMany({ where: { branchId: otherBranchId } })
        await superuserPrisma.user.deleteMany({ where: { branchId: otherBranchId } })
        await superuserPrisma.branch.delete({ where: { id: otherBranchId } })
      }
      await superuserPrisma.clinic.deleteMany({ where: { holdingCompanyId: otherHolding.id } })
      await superuserPrisma.holdingCompany.delete({ where: { id: otherHolding.id } })
    }
  })

  it("RLS backstop: a sibling branch's payment is invisible under branch 0's session context", async () => {
    const ownPayment = await payment(branches[0].id, patients[0][0], frontDeskUsers[0].id, 10000)
    const siblingPayment = await payment(branches[1].id, patients[1][0], frontDeskUsers[1].id, 20000)

    // Deliberately unfiltered by branch — proves Postgres itself hides the
    // row, independent of any where-clause the query layer adds.
    const hidden = await asSession(clinicAdmins[0], branches[0].id, (tx) => tx.payment.findMany({ where: { id: siblingPayment.id } }))
    expect(hidden).toHaveLength(0)

    // Positive control: identical query, identical code path, only
    // app.branch_id differs — so the emptiness above is keyed on the GUC and
    // not on a policy that hides everything.
    const visible = await asSession(clinicAdmins[0], branches[1].id, (tx) => tx.payment.findMany({ where: { id: siblingPayment.id } }))
    expect(visible).toHaveLength(1)

    const ownVisible = await asSession(clinicAdmins[0], branches[0].id, (tx) => tx.payment.findMany({ where: { id: ownPayment.id } }))
    expect(ownVisible).toHaveLength(1)
  })

  it("RLS backstop: a sibling branch's expense is invisible under branch 0's session context", async () => {
    const ownExpense = await expenseRow(branches[0].id, clinicAdmins[0].id, `${isoPrefix}-rls-own`, 1000)
    const siblingExpense = await expenseRow(branches[1].id, clinicAdmins[1].id, `${isoPrefix}-rls-sibling`, 2000)

    const hidden = await asSession(clinicAdmins[0], branches[0].id, (tx) => tx.expense.findMany({ where: { id: siblingExpense.id } }))
    expect(hidden).toHaveLength(0)

    const visible = await asSession(clinicAdmins[0], branches[1].id, (tx) => tx.expense.findMany({ where: { id: siblingExpense.id } }))
    expect(visible).toHaveLength(1)

    const ownVisible = await asSession(clinicAdmins[0], branches[0].id, (tx) => tx.expense.findMany({ where: { id: ownExpense.id } }))
    expect(ownVisible).toHaveLength(1)
  })

  it("RLS backstop: a sibling branch's remittance is invisible under branch 0's session context", async () => {
    const ownRemittance = await remittanceRow(branches[0].id, frontDeskUsers[0].id, 3000)
    const siblingRemittance = await remittanceRow(branches[1].id, frontDeskUsers[1].id, 4000)

    const hidden = await asSession(clinicAdmins[0], branches[0].id, (tx) => tx.remittance.findMany({ where: { id: siblingRemittance.id } }))
    expect(hidden).toHaveLength(0)

    const visible = await asSession(clinicAdmins[0], branches[1].id, (tx) => tx.remittance.findMany({ where: { id: siblingRemittance.id } }))
    expect(visible).toHaveLength(1)

    const ownVisible = await asSession(clinicAdmins[0], branches[0].id, (tx) => tx.remittance.findMany({ where: { id: ownRemittance.id } }))
    expect(ownVisible).toHaveLength(1)
  })

  it("RLS backstop: a HOLDING_ADMIN session context still sees all three branches' payments", async () => {
    const p0 = await payment(branches[0].id, patients[0][0], frontDeskUsers[0].id, 1000)
    const p1 = await payment(branches[1].id, patients[1][0], frontDeskUsers[1].id, 2000)
    const p2 = await payment(branches[2].id, patients[2][0], frontDeskUsers[2].id, 3000)

    // The complementary positive assertion for the three backstop tests
    // above: an over-broad "hide everything" policy would satisfy their
    // toHaveLength(0) but would fail here.
    const rows = await asSession(holdingAdmin, "", (tx) => tx.payment.findMany({ where: { id: { in: [p0.id, p1.id, p2.id] } } }))
    expect(rows.map((r) => r.id).sort()).toEqual([p0.id, p1.id, p2.id].sort())
  })
})
