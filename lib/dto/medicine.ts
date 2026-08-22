import type { Medicine, StockMovement } from "@prisma/client"

/**
 * For the consultation screen's medicine picker (§7.4: "name, strength,
 * form, and remaining quantity next to each option"). Deliberately omits
 * `unitCost` — the doctor picking a medicine to dispense has no reason to
 * see the clinic's cost basis, only what it's sold for.
 */
export type MedicineOptionDTO = {
  id: string
  name: string
  genericName: string | null
  form: Medicine["form"]
  strength: string | null
  unit: Medicine["unit"]
  currentStock: number
  reorderLevel: number
  sellingPrice: number
}

export function toMedicineOptionDTO(m: Medicine): MedicineOptionDTO {
  return {
    id: m.id,
    name: m.name,
    genericName: m.genericName,
    form: m.form,
    strength: m.strength,
    unit: m.unit,
    currentStock: m.currentStock,
    reorderLevel: m.reorderLevel,
    sellingPrice: m.sellingPrice,
  }
}

/** Full detail for the inventory screens (staff/clinic admin) — unlike the picker DTO, includes cost basis for valuation (§8). */
export type MedicineDetailDTO = {
  id: string
  name: string
  genericName: string | null
  form: Medicine["form"]
  strength: string | null
  unit: Medicine["unit"]
  currentStock: number
  reorderLevel: number
  unitCost: number
  sellingPrice: number
  expiryDate: Date | null
  isActive: boolean
  isLowStock: boolean
  isExpired: boolean
  isExpiringSoon: boolean
}

const EXPIRING_SOON_DAYS = 60

export function toMedicineDetailDTO(m: Medicine, now: Date = new Date()): MedicineDetailDTO {
  const expired = m.expiryDate !== null && m.expiryDate.getTime() < now.getTime()
  const expiringSoon =
    !expired && m.expiryDate !== null && m.expiryDate.getTime() < now.getTime() + EXPIRING_SOON_DAYS * 86_400_000
  return {
    id: m.id,
    name: m.name,
    genericName: m.genericName,
    form: m.form,
    strength: m.strength,
    unit: m.unit,
    currentStock: m.currentStock,
    reorderLevel: m.reorderLevel,
    unitCost: m.unitCost,
    sellingPrice: m.sellingPrice,
    expiryDate: m.expiryDate,
    isActive: m.isActive,
    isLowStock: m.currentStock <= m.reorderLevel,
    isExpired: expired,
    isExpiringSoon: expiringSoon,
  }
}

export type StockMovementDTO = {
  id: string
  movementType: StockMovement["movementType"]
  quantityChange: number
  balanceAfter: number
  reason: string | null
  referenceType: string | null
  performedByName: string
  createdAt: Date
}
