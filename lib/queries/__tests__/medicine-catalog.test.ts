import { describe, expect, it } from "vitest"
import { MEDICINE_CATALOG } from "@/prisma/medicine-catalog"
import { medicineCatalogSchema } from "@/lib/validation/medicine"

/**
 * The catalog is written by hand and applied to live branches by
 * prisma/seed-medicines.ts, so a typo in it becomes a row in a clinic's
 * inventory. These are the checks a reviewer would otherwise have to do by
 * eye across forty lines of near-identical objects.
 */
describe("MEDICINE_CATALOG", () => {
  it("covers the ~30 medicines §13 asks for", () => {
    expect(MEDICINE_CATALOG.length).toBeGreaterThanOrEqual(30)
  })

  it("has no duplicate names — the seeder dedupes on name, so a duplicate would silently seed only one", () => {
    const names = MEDICINE_CATALOG.map((m) => m.name.trim().toLowerCase())
    expect(new Set(names).size).toBe(names.length)
  })

  it("every entry passes the same validation the catalog screens enforce", () => {
    for (const m of MEDICINE_CATALOG) {
      const parsed = medicineCatalogSchema.safeParse({
        name: m.name,
        genericName: m.genericName,
        form: m.form,
        strength: m.strength,
        unit: m.unit,
        reorderLevel: m.reorderLevel,
        unitCost: m.unitCost,
        sellingPrice: m.sellingPrice,
        isActive: true,
      })
      expect(parsed.success, `${m.name} failed validation`).toBe(true)
    }
  })

  it("sells every medicine for more than it costs — a negative margin is always a typo here", () => {
    const underwater = MEDICINE_CATALOG.filter((m) => m.sellingPrice <= m.unitCost)
    expect(underwater.map((m) => m.name)).toEqual([])
  })

  it("prices and quantities are whole centavos and whole units", () => {
    for (const m of MEDICINE_CATALOG) {
      expect(Number.isInteger(m.unitCost), `${m.name} unitCost`).toBe(true)
      expect(Number.isInteger(m.sellingPrice), `${m.name} sellingPrice`).toBe(true)
      expect(Number.isInteger(m.reorderLevel), `${m.name} reorderLevel`).toBe(true)
      expect(Number.isInteger(m.openingStock), `${m.name} openingStock`).toBe(true)
      expect(m.openingStock, `${m.name} openingStock`).toBeGreaterThanOrEqual(0)
    }
  })

  it("keeps the two deliberately-low entries the demo dashboards need, and leaves the rest above reorder", () => {
    const low = MEDICINE_CATALOG.filter((m) => m.openingStock <= m.reorderLevel).map((m) => m.name)
    expect(low).toEqual(["Mefenamic Acid", "Salbutamol Syrup"])
  })
})
