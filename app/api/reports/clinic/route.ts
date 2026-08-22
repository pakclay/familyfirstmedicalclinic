import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getClinicReport } from "@/lib/queries/reports/clinic"
import { toCsv } from "@/lib/utils/csv"
import type { AbilitySubject } from "@/lib/permissions/ability"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user || session.user.role !== "CLINIC_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const user: AbilitySubject = {
    id: session.user.id,
    role: session.user.role,
    clinicId: session.user.clinicId,
    holdingCompanyId: session.user.holdingCompanyId,
  }
  const params = Object.fromEntries(req.nextUrl.searchParams)
  const report = await getClinicReport(user, params)

  const rows = [
    { metric: "Clinic", value: report.clinicName },
    { metric: "Date range", value: `${report.startLabel} to ${report.endLabel}` },
    { metric: "Visits", value: report.visitCount },
    { metric: "New patients", value: report.newPatientCount },
    { metric: "Returning patients", value: report.returningPatientCount },
    { metric: "Revenue total (PHP)", value: (report.revenueTotal / 100).toFixed(2) },
    { metric: "Average wait (minutes)", value: report.avgWaitMinutes ?? "" },
    { metric: "Average consultation (minutes)", value: report.avgConsultationMinutes ?? "" },
    { metric: "No-show rate", value: report.noShowRate !== null ? `${(report.noShowRate * 100).toFixed(1)}%` : "" },
    { metric: "Expenses total (PHP)", value: (report.expensesTotal / 100).toFixed(2) },
    { metric: "Net (PHP)", value: (report.net / 100).toFixed(2) },
    ...report.revenueByDoctor.map((d) => ({ metric: `Revenue — ${d.doctorName} (PHP)`, value: (d.amount / 100).toFixed(2) })),
    ...report.topDiagnoses.map((d) => ({ metric: `Diagnosis — ${d.diagnosis}`, value: d.count })),
    ...report.topMedicines.map((m) => ({ metric: `Medicine dispensed — ${m.medicineName}`, value: m.quantity })),
  ]

  return new NextResponse(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="clinic-report-${report.startLabel}-to-${report.endLabel}.csv"`,
    },
  })
}
