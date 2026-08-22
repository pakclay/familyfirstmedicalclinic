import { runWithRls } from "@/lib/db/rls"
import { requireClinicId, type AbilitySubject } from "@/lib/permissions/ability"
import { ForbiddenError } from "@/lib/permissions/errors"
import { toMedicineDetailDTO, type MedicineDetailDTO, type StockMovementDTO } from "@/lib/dto/medicine"
import { medicineCatalogSchema, receiveStockSchema, physicalCountSchema } from "@/lib/validation/medicine"

function requireClinicAdmin(user: AbilitySubject) {
  if (user.role !== "CLINIC_ADMIN") {
    throw new ForbiddenError("Only a clinic admin can manage the medicine catalog")
  }
}

export type InventoryFilter = "all" | "low-stock" | "expiring" | "expired"

/** §9 Staff screen: "inventory list with search and low-stock/expiry filters." */
export async function listMedicines(
  user: AbilitySubject,
  opts: { search?: string; filter?: InventoryFilter; includeInactive?: boolean } = {}
): Promise<MedicineDetailDTO[]> {
  const clinicId = requireClinicId(user)
  return runWithRls(user, async (tx) => {
    const medicines = await tx.medicine.findMany({
      where: {
        clinicId,
        isActive: opts.includeInactive ? undefined : true,
        ...(opts.search
          ? {
              OR: [
                { name: { contains: opts.search, mode: "insensitive" } },
                { genericName: { contains: opts.search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { name: "asc" },
    })
    const dtos = medicines.map((m) => toMedicineDetailDTO(m))
    if (opts.filter === "low-stock") return dtos.filter((m) => m.isLowStock)
    if (opts.filter === "expiring") return dtos.filter((m) => m.isExpiringSoon)
    if (opts.filter === "expired") return dtos.filter((m) => m.isExpired)
    return dtos
  })
}

export type MedicineWithLedger = { medicine: MedicineDetailDTO; ledger: StockMovementDTO[] }

/** One medicine's detail plus its full movement ledger — §9 "medicine movement ledger." */
export async function getMedicineWithLedger(user: AbilitySubject, medicineId: string): Promise<MedicineWithLedger | null> {
  const clinicId = requireClinicId(user)
  return runWithRls(user, async (tx) => {
    const medicine = await tx.medicine.findFirst({ where: { id: medicineId, clinicId } })
    if (!medicine) return null

    const movements = await tx.stockMovement.findMany({
      where: { medicineId, clinicId },
      include: { performedByUser: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    })

    return {
      medicine: toMedicineDetailDTO(medicine),
      ledger: movements.map((m) => ({
        id: m.id,
        movementType: m.movementType,
        quantityChange: m.quantityChange,
        balanceAfter: m.balanceAfter,
        reason: m.reason,
        referenceType: m.referenceType,
        performedByName: m.performedByUser.name,
        createdAt: m.createdAt,
      })),
    }
  })
}

/** §9 Clinic Admin: "manage medicine catalog (add, edit, set reorder level and prices, deactivate)." */
export async function createMedicine(user: AbilitySubject, input: unknown): Promise<MedicineDetailDTO> {
  requireClinicAdmin(user)
  const clinicId = requireClinicId(user)
  const parsed = medicineCatalogSchema.parse(input)

  return runWithRls(user, async (tx) => {
    const medicine = await tx.medicine.create({
      data: {
        clinicId,
        name: parsed.name,
        genericName: parsed.genericName || null,
        form: parsed.form,
        strength: parsed.strength || null,
        unit: parsed.unit,
        currentStock: 0,
        reorderLevel: parsed.reorderLevel,
        unitCost: parsed.unitCost,
        sellingPrice: parsed.sellingPrice,
        isActive: parsed.isActive,
      },
    })
    await tx.auditLog.create({
      data: { clinicId, userId: user.id, action: "medicine.create", entityType: "Medicine", entityId: medicine.id },
    })
    return toMedicineDetailDTO(medicine)
  })
}

/** Catalog fields only — never `currentStock`, which changes exclusively through a StockMovement (§6). */
export async function updateMedicine(user: AbilitySubject, medicineId: string, input: unknown): Promise<MedicineDetailDTO> {
  requireClinicAdmin(user)
  const clinicId = requireClinicId(user)
  const parsed = medicineCatalogSchema.parse(input)

  return runWithRls(user, async (tx) => {
    const existing = await tx.medicine.findFirst({ where: { id: medicineId, clinicId } })
    if (!existing) throw new ForbiddenError("Medicine not found in your clinic")

    const medicine = await tx.medicine.update({
      where: { id: medicineId },
      data: {
        name: parsed.name,
        genericName: parsed.genericName || null,
        form: parsed.form,
        strength: parsed.strength || null,
        unit: parsed.unit,
        reorderLevel: parsed.reorderLevel,
        unitCost: parsed.unitCost,
        sellingPrice: parsed.sellingPrice,
        isActive: parsed.isActive,
      },
    })
    await tx.auditLog.create({
      data: { clinicId, userId: user.id, action: "medicine.update", entityType: "Medicine", entityId: medicine.id },
    })
    return toMedicineDetailDTO(medicine)
  })
}

/** §7.5 "Stock in": writes a receipt movement and raises current_stock. */
export async function receiveStock(user: AbilitySubject, input: unknown): Promise<MedicineDetailDTO> {
  if (user.role !== "CLINIC_ADMIN" && user.role !== "FRONT_DESK") {
    throw new ForbiddenError("Only clinic staff can receive stock")
  }
  const clinicId = requireClinicId(user)
  const parsed = receiveStockSchema.parse(input)

  return runWithRls(user, async (tx) => {
    const medicine = await tx.medicine.findFirst({ where: { id: parsed.medicineId, clinicId } })
    if (!medicine) throw new ForbiddenError("Medicine not found in your clinic")

    const newStock = medicine.currentStock + parsed.quantity
    await tx.stockMovement.create({
      data: {
        clinicId,
        medicineId: medicine.id,
        movementType: "RECEIPT",
        quantityChange: parsed.quantity,
        balanceAfter: newStock,
        reason: "Stock received",
        performedByUserId: user.id,
      },
    })

    // §7.1's DECISION: "If a new delivery has a later expiry than the
    // remaining stock, the receipt screen asks whether to update the
    // expiry date" — `updateExpiryDate` is that explicit staff choice,
    // not an automatic max() comparison, since only a human knows whether
    // the new delivery is actually the one that should now govern the
    // single stored expiry date (§7.5: no batch/lot tracking in the MVP).
    const nextExpiry = parsed.updateExpiryDate && parsed.expiryDate ? parsed.expiryDate : medicine.expiryDate
    const updated = await tx.medicine.update({
      where: { id: medicine.id },
      data: { currentStock: newStock, unitCost: parsed.unitCost, expiryDate: nextExpiry },
    })

    await tx.auditLog.create({
      data: {
        clinicId,
        userId: user.id,
        action: "medicine.receive_stock",
        entityType: "Medicine",
        entityId: medicine.id,
        changes: { quantity: parsed.quantity },
      },
    })

    return toMedicineDetailDTO(updated)
  })
}

export type PhysicalCountResult = { totalVarianceCentavos: number; discrepancies: number }

/** §7.5 "Physical count": one adjustment movement per discrepancy, with a required reason, and the total variance in pesos. */
export async function submitPhysicalCount(user: AbilitySubject, input: unknown): Promise<PhysicalCountResult> {
  if (user.role !== "CLINIC_ADMIN" && user.role !== "FRONT_DESK") {
    throw new ForbiddenError("Only clinic staff can submit a physical count")
  }
  const clinicId = requireClinicId(user)
  const parsed = physicalCountSchema.parse(input)

  return runWithRls(user, async (tx) => {
    const medicineIds = parsed.counts.map((c) => c.medicineId)
    const medicines = await tx.medicine.findMany({ where: { id: { in: medicineIds }, clinicId } })
    const medicineById = new Map(medicines.map((m) => [m.id, m]))

    let totalVarianceCentavos = 0
    let discrepancies = 0

    for (const count of parsed.counts) {
      const medicine = medicineById.get(count.medicineId)
      if (!medicine) continue // not this clinic's medicine — silently skip rather than fail the whole batch
      const variance = count.countedQuantity - medicine.currentStock
      if (variance === 0) continue

      discrepancies += 1
      totalVarianceCentavos += variance * medicine.unitCost

      await tx.stockMovement.create({
        data: {
          clinicId,
          medicineId: medicine.id,
          movementType: "ADJUSTMENT",
          quantityChange: variance,
          balanceAfter: count.countedQuantity,
          reason: parsed.reason,
          performedByUserId: user.id,
        },
      })
      await tx.medicine.update({ where: { id: medicine.id }, data: { currentStock: count.countedQuantity } })
    }

    await tx.auditLog.create({
      data: {
        clinicId,
        userId: user.id,
        action: "medicine.physical_count",
        entityType: "Medicine",
        entityId: null,
        changes: { discrepancies, totalVarianceCentavos, reason: parsed.reason },
      },
    })

    return { totalVarianceCentavos, discrepancies }
  })
}

/**
 * §7.5 "Corrections": editing or deleting a dispensed row after saving
 * writes a compensating `return` movement rather than editing the
 * original — stock history is append-only. Scoped to clinic admins: a
 * correction is an oversight action on an already-saved clinical/
 * financial record, not something the original doctor should be able to
 * quietly undo unilaterally after the fact.
 */
export async function deleteDispensedMedicine(
  user: AbilitySubject,
  medicineDispensedId: string,
  reason: string
): Promise<void> {
  requireClinicAdmin(user)
  const clinicId = requireClinicId(user)
  if (!reason.trim()) throw new Error("A reason is required to delete a dispensed medicine")

  await runWithRls(user, async (tx) => {
    const dispensed = await tx.medicineDispensed.findFirst({ where: { id: medicineDispensedId, clinicId, deletedAt: null } })
    if (!dispensed) throw new ForbiddenError("Dispensed medicine not found in your clinic")

    if (dispensed.stockMovementId && dispensed.medicineId) {
      const medicine = await tx.medicine.findFirstOrThrow({ where: { id: dispensed.medicineId, clinicId } })
      const newStock = medicine.currentStock + dispensed.quantity
      await tx.stockMovement.create({
        data: {
          clinicId,
          medicineId: dispensed.medicineId,
          movementType: "RETURN",
          quantityChange: dispensed.quantity,
          balanceAfter: newStock,
          reason,
          referenceType: "MedicineDispensed",
          referenceId: dispensed.id,
          performedByUserId: user.id,
        },
      })
      await tx.medicine.update({ where: { id: dispensed.medicineId }, data: { currentStock: newStock } })
    }

    await tx.medicineDispensed.update({ where: { id: dispensed.id }, data: { deletedAt: new Date() } })
    await tx.auditLog.create({
      data: {
        clinicId,
        userId: user.id,
        action: "medicine_dispensed.delete",
        entityType: "MedicineDispensed",
        entityId: dispensed.id,
        changes: { reason },
      },
    })
  })
}

export type InventoryDashboardPanels = {
  lowStock: MedicineDetailDTO[]
  expiringSoon: MedicineDetailDTO[]
  expired: MedicineDetailDTO[]
}

/** §7.5 / §9 Clinic Admin dashboard panels. */
export async function getInventoryDashboardPanels(user: AbilitySubject): Promise<InventoryDashboardPanels> {
  const all = await listMedicines(user)
  return {
    lowStock: all.filter((m) => m.isLowStock),
    expiringSoon: all.filter((m) => m.isExpiringSoon),
    expired: all.filter((m) => m.isExpired),
  }
}
