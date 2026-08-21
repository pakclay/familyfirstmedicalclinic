import type { Medicine } from "@prisma/client"

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
