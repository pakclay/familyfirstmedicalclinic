import { runWithRls } from "@/lib/db/rls"
import { requireBranchId, type AbilitySubject } from "@/lib/permissions/ability"
import { branchTimezone } from "@/lib/queries/queue"
import { resolveReportInstantRange, type DateRangeParams } from "@/lib/utils/report-dates"
import { listMedicines, getInventoryDashboardPanels, type InventoryDashboardPanels } from "@/lib/queries/inventory"
import type { MedicineDetailDTO } from "@/lib/dto/medicine"

export type InventoryReportRow = {
  medicineId: string
  medicineName: string
  currentStock: number
  valuationCentavos: number
  receivedInRange: number
  dispensedInRange: number
  adjustedInRange: number
  returnedInRange: number
}

export type InventoryReportData = {
  startLabel: string
  endLabel: string
  totalValuationCentavos: number
  rows: InventoryReportRow[]
  panels: InventoryDashboardPanels
}

/**
 * §8 "Inventory" report: valuation at cost, consumption per medicine over
 * a range, and the reconciliation view — "we bought 500 tablets, dispensed
 * 380, so where are the other 120?" is answered by reading the
 * received/dispensed/adjusted/returned columns side by side for one
 * medicine, all sourced from the same append-only ledger M4b already
 * writes to.
 */
export async function getInventoryReport(user: AbilitySubject, params: DateRangeParams): Promise<InventoryReportData> {
  const branchId = requireBranchId(user)

  return runWithRls(user, async (tx) => {
    const timezone = await branchTimezone(tx, branchId)
    const { start, end, startLabel, endLabel } = resolveReportInstantRange(params, timezone)

    const medicines: MedicineDetailDTO[] = await listMedicines(user, { includeInactive: true })
    const totalValuationCentavos = medicines.reduce((sum, m) => sum + m.currentStock * m.unitCost, 0)

    const movements = await tx.stockMovement.findMany({
      where: { branchId, createdAt: { gte: start, lt: end } },
      select: { medicineId: true, movementType: true, quantityChange: true },
    })

    const byMedicine = new Map<string, { received: number; dispensed: number; adjusted: number; returned: number }>()
    for (const m of movements) {
      const bucket = byMedicine.get(m.medicineId) ?? { received: 0, dispensed: 0, adjusted: 0, returned: 0 }
      if (m.movementType === "RECEIPT") bucket.received += m.quantityChange
      else if (m.movementType === "DISPENSE") bucket.dispensed += -m.quantityChange // stored negative
      else if (m.movementType === "ADJUSTMENT") bucket.adjusted += m.quantityChange
      else if (m.movementType === "RETURN") bucket.returned += m.quantityChange
      byMedicine.set(m.medicineId, bucket)
    }

    const rows: InventoryReportRow[] = medicines
      .filter((m) => byMedicine.has(m.id) || m.currentStock > 0)
      .map((m) => {
        const bucket = byMedicine.get(m.id) ?? { received: 0, dispensed: 0, adjusted: 0, returned: 0 }
        return {
          medicineId: m.id,
          medicineName: m.name,
          currentStock: m.currentStock,
          valuationCentavos: m.currentStock * m.unitCost,
          receivedInRange: bucket.received,
          dispensedInRange: bucket.dispensed,
          adjustedInRange: bucket.adjusted,
          returnedInRange: bucket.returned,
        }
      })
      .sort((a, b) => b.dispensedInRange - a.dispensedInRange)

    const panels = await getInventoryDashboardPanels(user)

    return { startLabel, endLabel, totalValuationCentavos, rows, panels }
  })
}
