import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getHoldingConsolidatedReport } from "@/lib/queries/reports/holding"
import { toCsv } from "@/lib/utils/csv"
import type { AbilitySubject } from "@/lib/permissions/ability"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user || session.user.role !== "HOLDING_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const user: AbilitySubject = {
    id: session.user.id,
    role: session.user.role,
    branchId: session.user.branchId,
    holdingCompanyId: session.user.holdingCompanyId,
  }
  const params = Object.fromEntries(req.nextUrl.searchParams)
  const report = await getHoldingConsolidatedReport(user, params)

  const rows = [
    ...report.branches.map((b) => ({
      clinic: b.clinicName,
      branch: b.branchName,
      revenuePHP: (b.revenueTotal / 100).toFixed(2),
      expensesPHP: (b.expensesTotal / 100).toFixed(2),
      netPHP: (b.net / 100).toFixed(2),
      visits: b.visitCount,
    })),
    {
      clinic: "Consolidated (all branches)",
      branch: "",
      revenuePHP: (report.consolidated.revenueTotal / 100).toFixed(2),
      expensesPHP: (report.consolidated.expensesTotal / 100).toFixed(2),
      netPHP: (report.consolidated.net / 100).toFixed(2),
      visits: report.branches.reduce((sum, b) => sum + b.visitCount, 0),
    },
  ]

  return new NextResponse(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="holding-report-${report.startLabel}-to-${report.endLabel}.csv"`,
    },
  })
}
