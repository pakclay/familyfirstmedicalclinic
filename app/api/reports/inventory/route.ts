import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getInventoryReport } from "@/lib/queries/reports/inventory"
import { toCsv } from "@/lib/utils/csv"
import type { AbilitySubject } from "@/lib/permissions/ability"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user || (session.user.role !== "CLINIC_ADMIN" && session.user.role !== "FRONT_DESK")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const user: AbilitySubject = {
    id: session.user.id,
    role: session.user.role,
    branchId: session.user.branchId,
    holdingCompanyId: session.user.holdingCompanyId,
  }
  const params = Object.fromEntries(req.nextUrl.searchParams)
  const report = await getInventoryReport(user, params)

  const rows = report.rows.map((r) => ({
    medicine: r.medicineName,
    currentStock: r.currentStock,
    valuationPHP: (r.valuationCentavos / 100).toFixed(2),
    receivedInRange: r.receivedInRange,
    dispensedInRange: r.dispensedInRange,
    adjustedInRange: r.adjustedInRange,
    returnedInRange: r.returnedInRange,
  }))

  return new NextResponse(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="inventory-report-${report.startLabel}-to-${report.endLabel}.csv"`,
    },
  })
}
