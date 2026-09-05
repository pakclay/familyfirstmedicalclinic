import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getBranchReport } from "@/lib/queries/reports/clinic"
import { getInventoryReport } from "@/lib/queries/reports/inventory"
import { getHoldingConsolidatedReport } from "@/lib/queries/reports/holding"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { DateRangeForm } from "./date-range-form"
import { RevenueChart } from "./revenue-chart"

function pesos(centavos: number): string {
  return `₱${(centavos / 100).toFixed(2)}`
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string; end?: string }>
}) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (session.user.role !== "CLINIC_ADMIN" && session.user.role !== "HOLDING_ADMIN") redirect("/")

  const params = await searchParams
  const user: AbilitySubject = {
    id: session.user.id,
    role: session.user.role,
    branchId: session.user.branchId,
    holdingCompanyId: session.user.holdingCompanyId,
  }

  if (session.user.role === "HOLDING_ADMIN") {
    const report = await getHoldingConsolidatedReport(user, params)
    return (
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-heading font-semibold">Consolidated reports</h1>
          <Button asChild variant="outline" size="sm">
            <Link prefetch={false} href={`/api/reports/holding?start=${report.startLabel}&end=${report.endLabel}`}>Download CSV</Link>
          </Button>
        </div>
        <div className="mt-3">
          <DateRangeForm start={report.startLabel} end={report.endLabel} />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{report.startLabel} to {report.endLabel}</p>

        <div className="mt-6 grid grid-cols-3 gap-4">
          <Stat label="Combined revenue" value={pesos(report.consolidated.revenueTotal)} />
          <Stat label="Combined expenses" value={pesos(report.consolidated.expensesTotal)} />
          <Stat label="Combined net" value={pesos(report.consolidated.net)} />
        </div>

        <h2 className="mt-8 text-lg font-heading font-semibold">Branches</h2>
        <div className="overflow-x-auto">
          <table className="mt-2 w-full min-w-[480px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2">Clinic</th>
                <th className="py-2">Branch</th>
                <th className="py-2 text-right">Visits</th>
                <th className="py-2 text-right">Revenue</th>
                <th className="py-2 text-right">Expenses</th>
                <th className="py-2 text-right">Net</th>
              </tr>
            </thead>
            <tbody>
              {report.branches.map((b) => (
                <tr key={b.branchId} className="border-b border-border">
                  <td className="py-2 text-muted-foreground">{b.clinicName}</td>
                  <td className="py-2">{b.branchName}</td>
                  <td className="py-2 text-right font-numeric">{b.visitCount}</td>
                  <td className="py-2 text-right font-numeric">{pesos(b.revenueTotal)}</td>
                  <td className="py-2 text-right font-numeric">{pesos(b.expensesTotal)}</td>
                  <td className="py-2 text-right font-numeric">{pesos(b.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <h2 className="text-lg font-heading font-semibold">Ranked by revenue</h2>
            <ol className="mt-2 space-y-1 text-sm">
              {report.rankingByRevenue.map((b, i) => (
                <li key={b.branchId} className="flex justify-between">
                  <span>{i + 1}. {b.clinicName} — {b.branchName}</span>
                  <span className="font-numeric text-muted-foreground">{pesos(b.revenueTotal)}</span>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h2 className="text-lg font-heading font-semibold">Ranked by volume</h2>
            <ol className="mt-2 space-y-1 text-sm">
              {report.rankingByVolume.map((b, i) => (
                <li key={b.branchId} className="flex justify-between">
                  <span>{i + 1}. {b.clinicName} — {b.branchName}</span>
                  <span className="font-numeric text-muted-foreground">{b.visitCount} visits</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    )
  }

  const [branchReport, inventoryReport] = await Promise.all([
    getBranchReport(user, params),
    getInventoryReport(user, params),
  ])

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-heading font-semibold">Reports</h1>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link prefetch={false} href={`/api/reports/clinic?start=${branchReport.startLabel}&end=${branchReport.endLabel}`}>Clinic CSV</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link prefetch={false} href={`/api/reports/inventory?start=${inventoryReport.startLabel}&end=${inventoryReport.endLabel}`}>Inventory CSV</Link>
          </Button>
        </div>
      </div>
      <div className="mt-3">
        <DateRangeForm start={branchReport.startLabel} end={branchReport.endLabel} />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{branchReport.startLabel} to {branchReport.endLabel}</p>

      <div className="mt-6 grid grid-cols-3 gap-4 sm:grid-cols-5">
        <Stat label="Visits" value={String(branchReport.visitCount)} />
        <Stat label="New" value={String(branchReport.newPatientCount)} />
        <Stat label="Returning" value={String(branchReport.returningPatientCount)} />
        <Stat label="Revenue" value={pesos(branchReport.revenueTotal)} />
        <Stat label="Net" value={pesos(branchReport.net)} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-4">
        <Stat label="Avg. wait" value={branchReport.avgWaitMinutes !== null ? `${branchReport.avgWaitMinutes} min` : "—"} />
        <Stat label="Avg. consultation" value={branchReport.avgConsultationMinutes !== null ? `${branchReport.avgConsultationMinutes} min` : "—"} />
        <Stat label="No-show rate" value={branchReport.noShowRate !== null ? `${(branchReport.noShowRate * 100).toFixed(0)}%` : "—"} />
      </div>

      <h2 className="mt-8 text-lg font-heading font-semibold">Revenue over time</h2>
      <div className="mt-2 rounded-md border border-border p-2">
        <RevenueChart data={branchReport.dailyRevenue} />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-3">
        <ListSection title="Revenue by doctor" items={branchReport.revenueByDoctor.map((d) => ({ label: d.doctorName, value: pesos(d.amount) }))} />
        <ListSection title="Top diagnoses" items={branchReport.topDiagnoses.map((d) => ({ label: d.diagnosis, value: String(d.count) }))} />
        <ListSection title="Top medicines" items={branchReport.topMedicines.map((m) => ({ label: m.medicineName, value: String(m.quantity) }))} />
      </div>

      <h2 className="mt-8 text-lg font-heading font-semibold">Inventory</h2>
      <p className="text-sm text-muted-foreground">
        Stock valuation at cost: <span className="font-numeric text-foreground">{pesos(inventoryReport.totalValuationCentavos)}</span>
      </p>
      <div className="mt-2 flex gap-2">
        {inventoryReport.panels.lowStock.length > 0 && <Badge variant="outline" className="border-priority text-priority">{inventoryReport.panels.lowStock.length} low stock</Badge>}
        {inventoryReport.panels.expiringSoon.length > 0 && <Badge variant="outline" className="border-signal text-signal">{inventoryReport.panels.expiringSoon.length} expiring soon</Badge>}
        {inventoryReport.panels.expired.length > 0 && <Badge variant="outline" className="border-destructive text-destructive">{inventoryReport.panels.expired.length} expired</Badge>}
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="py-2">Medicine</th>
              <th className="py-2 text-right">Stock</th>
              <th className="py-2 text-right">Received</th>
              <th className="py-2 text-right">Dispensed</th>
              <th className="py-2 text-right">Adjusted</th>
              <th className="py-2 text-right">Returned</th>
            </tr>
          </thead>
          <tbody>
            {inventoryReport.rows.map((r) => (
              <tr key={r.medicineId} className="border-b border-border">
                <td className="py-2">
                  <Link prefetch={false} href={`/staff/inventory/${r.medicineId}`} className="hover:underline">
                    {r.medicineName}
                  </Link>
                </td>
                <td className="py-2 text-right font-numeric">{r.currentStock}</td>
                <td className="py-2 text-right font-numeric">{r.receivedInRange || "—"}</td>
                <td className="py-2 text-right font-numeric">{r.dispensedInRange || "—"}</td>
                <td className="py-2 text-right font-numeric">{r.adjustedInRange || "—"}</td>
                <td className="py-2 text-right font-numeric">{r.returnedInRange || "—"}</td>
              </tr>
            ))}
            {inventoryReport.rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-muted-foreground">No stock activity in this range.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-numeric text-lg font-semibold">{value}</p>
    </div>
  )
}

function ListSection({ title, items }: { title: string; items: { label: string; value: string }[] }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      <ul className="mt-1 space-y-1 text-sm">
        {items.map((item, i) => (
          <li key={i} className="flex justify-between gap-2">
            <span className="truncate">{item.label}</span>
            <span className="font-numeric shrink-0 text-muted-foreground">{item.value}</span>
          </li>
        ))}
        {items.length === 0 && <li className="text-muted-foreground">None yet.</li>}
      </ul>
    </div>
  )
}
