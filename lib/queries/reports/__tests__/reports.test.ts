import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { Role, Sex } from "@prisma/client"
import { superuserPrisma } from "@/lib/test/superuser-prisma"
import { prisma } from "@/lib/db/prisma"
import { getBranchReport } from "@/lib/queries/reports/clinic"
import { getHoldingConsolidatedReport } from "@/lib/queries/reports/holding"
import { submitRemittance, getMyRemittanceStatus, listPendingRemittances, confirmRemittance } from "@/lib/queries/remittance"
import { createExpense, listExpenses } from "@/lib/queries/expenses"
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
})
