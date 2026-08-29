import { toZonedTime } from "date-fns-tz"
import { runWithRls } from "@/lib/db/rls"
import { requireBranchId, type AbilitySubject } from "@/lib/permissions/ability"
import { resolveReportInstantRange, resolveReportDateOnlyRange, type DateRangeParams } from "@/lib/utils/report-dates"

export type BranchReportData = {
  branchName: string
  startLabel: string
  endLabel: string
  visitCount: number
  newPatientCount: number
  returningPatientCount: number
  revenueTotal: number
  revenueByDoctor: { doctorName: string; amount: number }[]
  avgWaitMinutes: number | null
  avgConsultationMinutes: number | null
  noShowRate: number | null
  topDiagnoses: { diagnosis: string; count: number }[]
  topMedicines: { medicineName: string; quantity: number }[]
  expensesTotal: number
  net: number
  dailyRevenue: { date: string; amount: number }[]
}

/**
 * §8 "Clinic level" report — now scoped per branch, the physical location
 * a Clinic Admin actually runs. Fetches each dataset with its own targeted
 * query and derives everything else in JS — a handful of extra round
 * trips, but each one reads plainly and the data volumes an MVP branch
 * produces in a month are nowhere near where that would matter.
 */
export async function getBranchReport(user: AbilitySubject, params: DateRangeParams): Promise<BranchReportData> {
  const branchId = requireBranchId(user)

  return runWithRls(user, async (tx) => {
    const branch = await tx.branch.findUniqueOrThrow({ where: { id: branchId }, select: { name: true, timezone: true } })
    const { start, end, startLabel, endLabel } = resolveReportInstantRange(params, branch.timezone)
    const dateOnlyRange = resolveReportDateOnlyRange(params, branch.timezone)

    // Population: every visit that actually arrived (checked in) in range.
    // markNoShow only accepts CHECKED_IN/WAITING/CALLED entries, so every
    // NO_SHOW row here necessarily has checkedInAt set — a patient who
    // never arrived can't become a no-show, only stay BOOKED or CANCELLED.
    const visits = await tx.queueEntry.findMany({
      where: { branchId, checkedInAt: { gte: start, lt: end } },
      select: { id: true, patientId: true, status: true, checkedInAt: true, calledAt: true, startedAt: true, completedAt: true },
    })
    const visitCount = visits.length
    const noShowCount = visits.filter((v) => v.status === "NO_SHOW").length
    const noShowRate = visitCount > 0 ? noShowCount / visitCount : null

    const waitTimes = visits.filter((v) => v.calledAt).map((v) => v.calledAt!.getTime() - v.checkedInAt!.getTime())
    const avgWaitMinutes = waitTimes.length > 0 ? avgMinutes(waitTimes) : null

    const consultationTimes = visits
      .filter((v) => v.startedAt && v.completedAt)
      .map((v) => v.completedAt!.getTime() - v.startedAt!.getTime())
    const avgConsultationMinutes = consultationTimes.length > 0 ? avgMinutes(consultationTimes) : null

    // New vs. returning: a patient is "new" here if their earliest-ever
    // checked-in visit at this branch falls inside the selected range.
    const distinctPatientIds = [...new Set(visits.map((v) => v.patientId))]
    const priorVisits = distinctPatientIds.length
      ? await tx.queueEntry.findMany({
          where: { branchId, patientId: { in: distinctPatientIds }, checkedInAt: { lt: start } },
          select: { patientId: true },
          distinct: ["patientId"],
        })
      : []
    const hadPriorVisit = new Set(priorVisits.map((v) => v.patientId))
    const newPatientCount = distinctPatientIds.filter((id) => !hadPriorVisit.has(id)).length
    const returningPatientCount = distinctPatientIds.length - newPatientCount

    const payments = await tx.payment.findMany({
      where: { branchId, receivedAt: { gte: start, lt: end } },
      select: {
        amount: true,
        receivedAt: true,
        consultation: { select: { doctor: { select: { user: { select: { name: true } } } } } },
      },
    })
    const revenueTotal = payments.reduce((sum, p) => sum + p.amount, 0)
    const revenueByDoctorMap = new Map<string, number>()
    for (const p of payments) {
      const name = p.consultation?.doctor.user.name ?? "Unassigned"
      revenueByDoctorMap.set(name, (revenueByDoctorMap.get(name) ?? 0) + p.amount)
    }
    const revenueByDoctor = [...revenueByDoctorMap.entries()]
      .map(([doctorName, amount]) => ({ doctorName, amount }))
      .sort((a, b) => b.amount - a.amount)

    const dailyRevenueMap = new Map<string, number>()
    for (const p of payments) {
      // toZonedTime's result must be read with plain (non-UTC) getters —
      // see todayAsQueueDate in lib/queries/queue.ts for why.
      const zoned = toZonedTime(p.receivedAt, branch.timezone)
      const dayLabel = `${zoned.getFullYear()}-${String(zoned.getMonth() + 1).padStart(2, "0")}-${String(zoned.getDate()).padStart(2, "0")}`
      dailyRevenueMap.set(dayLabel, (dailyRevenueMap.get(dayLabel) ?? 0) + p.amount)
    }
    const dailyRevenue = [...dailyRevenueMap.entries()]
      .map(([date, amount]) => ({ date, amount }))
      .sort((a, b) => a.date.localeCompare(b.date))

    const consultations = await tx.consultation.findMany({
      where: { branchId, createdAt: { gte: start, lt: end }, deletedAt: null },
      select: { id: true, diagnosis: true },
    })
    const diagnosisCounts = new Map<string, number>()
    for (const c of consultations) {
      if (!c.diagnosis?.trim()) continue
      diagnosisCounts.set(c.diagnosis, (diagnosisCounts.get(c.diagnosis) ?? 0) + 1)
    }
    const topDiagnoses = [...diagnosisCounts.entries()]
      .map(([diagnosis, count]) => ({ diagnosis, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)

    const consultationIds = consultations.map((c) => c.id)
    const dispensed = consultationIds.length
      ? await tx.medicineDispensed.findMany({
          where: { branchId, consultationId: { in: consultationIds }, deletedAt: null },
          select: { medicineName: true, quantity: true },
        })
      : []
    const medicineCounts = new Map<string, number>()
    for (const d of dispensed) {
      medicineCounts.set(d.medicineName, (medicineCounts.get(d.medicineName) ?? 0) + d.quantity)
    }
    const topMedicines = [...medicineCounts.entries()]
      .map(([medicineName, quantity]) => ({ medicineName, quantity }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5)

    const expenses = await tx.expense.findMany({
      where: { branchId, expenseDate: { gte: dateOnlyRange.start, lte: dateOnlyRange.end } },
      select: { amount: true },
    })
    const expensesTotal = expenses.reduce((sum, e) => sum + e.amount, 0)

    return {
      branchName: branch.name,
      startLabel,
      endLabel,
      visitCount,
      newPatientCount,
      returningPatientCount,
      revenueTotal,
      revenueByDoctor,
      avgWaitMinutes,
      avgConsultationMinutes,
      noShowRate,
      topDiagnoses,
      topMedicines,
      expensesTotal,
      net: revenueTotal - expensesTotal,
      dailyRevenue,
    }
  })
}

function avgMinutes(msDiffs: number[]): number {
  const avgMs = msDiffs.reduce((sum, ms) => sum + ms, 0) / msDiffs.length
  return Math.round(avgMs / 60000)
}
