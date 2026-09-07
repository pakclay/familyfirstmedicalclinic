import { MedicineForm, MedicineUnit } from "@prisma/client"

/**
 * The starting medicine catalog for a Philippine primary-care clinic —
 * §13's "~30 medicines", shared by the two things that create them:
 * `prisma/seed.ts` (which wipes and rebuilds a demo database) and
 * `prisma/seed-medicines.ts` (which only ever adds, and is the one safe to
 * point at a clinic that is already running).
 *
 * Two fields are catalog facts and two are not. `reorderLevel`, `unitCost`
 * and `sellingPrice` describe the medicine and belong here. `openingStock`
 * is a *seeding* number, not a fact about the medicine — a clinic's real
 * quantities come from receiving stock, which is why the additive seeder
 * ignores it unless explicitly asked. Nothing here invents an expiry date;
 * expiry belongs to a delivery, so the demo seed applies its own.
 *
 * Money is centavos throughout, as everywhere else in this codebase.
 * Prices are plausible Philippine retail, not a price list anyone has
 * approved — a clinic is expected to edit them, which is exactly what the
 * catalog screens are for. They are deliberately unchanged for the eight
 * medicines that were already seeded before this file existed, so
 * re-running nothing re-prices anything.
 */
export type MedicineCatalogEntry = {
  name: string
  genericName: string
  form: MedicineForm
  strength: string
  unit: MedicineUnit
  reorderLevel: number
  /** centavos */
  unitCost: number
  /** centavos */
  sellingPrice: number
  /** Demo/staging opening quantity only — see the note above. */
  openingStock: number
}

const T = MedicineForm.TABLET
const C = MedicineForm.CAPSULE
const S = MedicineForm.SYRUP
const I = MedicineForm.INJECTION
const O = MedicineForm.OINTMENT
const X = MedicineForm.OTHER
const PC = MedicineUnit.PIECE
const BT = MedicineUnit.BOTTLE
const VL = MedicineUnit.VIAL
const SA = MedicineUnit.SACHET

export const MEDICINE_CATALOG: MedicineCatalogEntry[] = [
  // ── Analgesics / antipyretics ────────────────────────────────────────
  { name: "Paracetamol", genericName: "Paracetamol", form: T, strength: "500mg", unit: PC, reorderLevel: 50, unitCost: 150, sellingPrice: 300, openingStock: 200 },
  { name: "Paracetamol Syrup", genericName: "Paracetamol", form: S, strength: "250mg/5mL", unit: BT, reorderLevel: 15, unitCost: 6500, sellingPrice: 12000, openingStock: 40 },
  // Deliberately seeded below its reorder level, so the low-stock panel has
  // something to show on a fresh demo database.
  { name: "Mefenamic Acid", genericName: "Mefenamic Acid", form: T, strength: "500mg", unit: PC, reorderLevel: 40, unitCost: 200, sellingPrice: 400, openingStock: 30 },
  { name: "Ibuprofen", genericName: "Ibuprofen", form: T, strength: "400mg", unit: PC, reorderLevel: 40, unitCost: 200, sellingPrice: 400, openingStock: 100 },
  { name: "Naproxen", genericName: "Naproxen Sodium", form: T, strength: "550mg", unit: PC, reorderLevel: 20, unitCost: 900, sellingPrice: 1600, openingStock: 50 },

  // ── Antibiotics ──────────────────────────────────────────────────────
  { name: "Amoxicillin", genericName: "Amoxicillin", form: C, strength: "500mg", unit: PC, reorderLevel: 40, unitCost: 350, sellingPrice: 700, openingStock: 120 },
  { name: "Amoxicillin Suspension", genericName: "Amoxicillin", form: S, strength: "250mg/5mL", unit: BT, reorderLevel: 15, unitCost: 9000, sellingPrice: 16000, openingStock: 30 },
  { name: "Co-Amoxiclav", genericName: "Amoxicillin + Clavulanic Acid", form: T, strength: "625mg", unit: PC, reorderLevel: 30, unitCost: 2200, sellingPrice: 4000, openingStock: 60 },
  { name: "Cefalexin", genericName: "Cefalexin", form: C, strength: "500mg", unit: PC, reorderLevel: 30, unitCost: 800, sellingPrice: 1500, openingStock: 80 },
  { name: "Cloxacillin", genericName: "Cloxacillin", form: C, strength: "500mg", unit: PC, reorderLevel: 30, unitCost: 700, sellingPrice: 1300, openingStock: 60 },
  { name: "Azithromycin", genericName: "Azithromycin", form: T, strength: "500mg", unit: PC, reorderLevel: 20, unitCost: 3500, sellingPrice: 6000, openingStock: 40 },
  { name: "Metronidazole", genericName: "Metronidazole", form: T, strength: "500mg", unit: PC, reorderLevel: 30, unitCost: 300, sellingPrice: 600, openingStock: 80 },
  { name: "Cotrimoxazole", genericName: "Sulfamethoxazole + Trimethoprim", form: T, strength: "800mg/160mg", unit: PC, reorderLevel: 30, unitCost: 400, sellingPrice: 800, openingStock: 60 },

  // ── Antihistamines / respiratory ─────────────────────────────────────
  { name: "Cetirizine", genericName: "Cetirizine", form: T, strength: "10mg", unit: PC, reorderLevel: 30, unitCost: 180, sellingPrice: 350, openingStock: 90 },
  { name: "Loratadine", genericName: "Loratadine", form: T, strength: "10mg", unit: PC, reorderLevel: 30, unitCost: 250, sellingPrice: 500, openingStock: 80 },
  // Also below reorder on a fresh demo database, on purpose.
  { name: "Salbutamol Syrup", genericName: "Salbutamol", form: S, strength: "2mg/5mL", unit: BT, reorderLevel: 20, unitCost: 8000, sellingPrice: 15000, openingStock: 15 },
  { name: "Salbutamol Nebule", genericName: "Salbutamol", form: X, strength: "2.5mg/2.5mL", unit: PC, reorderLevel: 20, unitCost: 1800, sellingPrice: 3000, openingStock: 40 },
  { name: "Carbocisteine", genericName: "Carbocisteine", form: C, strength: "500mg", unit: PC, reorderLevel: 30, unitCost: 500, sellingPrice: 1000, openingStock: 80 },
  { name: "Ambroxol", genericName: "Ambroxol", form: T, strength: "30mg", unit: PC, reorderLevel: 30, unitCost: 400, sellingPrice: 800, openingStock: 60 },

  // ── Gastrointestinal ─────────────────────────────────────────────────
  { name: "Omeprazole", genericName: "Omeprazole", form: C, strength: "20mg", unit: PC, reorderLevel: 30, unitCost: 600, sellingPrice: 1200, openingStock: 60 },
  { name: "Famotidine", genericName: "Famotidine", form: T, strength: "20mg", unit: PC, reorderLevel: 20, unitCost: 500, sellingPrice: 1000, openingStock: 50 },
  { name: "Antacid Suspension", genericName: "Aluminium + Magnesium Hydroxide", form: S, strength: "120mL", unit: BT, reorderLevel: 10, unitCost: 7000, sellingPrice: 12000, openingStock: 25 },
  { name: "Loperamide", genericName: "Loperamide", form: C, strength: "2mg", unit: PC, reorderLevel: 30, unitCost: 300, sellingPrice: 600, openingStock: 60 },
  { name: "Hyoscine Butylbromide", genericName: "Hyoscine-N-Butylbromide", form: T, strength: "10mg", unit: PC, reorderLevel: 20, unitCost: 900, sellingPrice: 1600, openingStock: 40 },
  { name: "Oral Rehydration Salts", genericName: "ORS", form: X, strength: "20.5g", unit: SA, reorderLevel: 30, unitCost: 1500, sellingPrice: 2500, openingStock: 100 },

  // ── Maintenance ──────────────────────────────────────────────────────
  { name: "Amlodipine", genericName: "Amlodipine", form: T, strength: "5mg", unit: PC, reorderLevel: 20, unitCost: 250, sellingPrice: 500, openingStock: 60 },
  { name: "Losartan", genericName: "Losartan Potassium", form: T, strength: "50mg", unit: PC, reorderLevel: 30, unitCost: 700, sellingPrice: 1300, openingStock: 60 },
  { name: "Metformin", genericName: "Metformin", form: T, strength: "500mg", unit: PC, reorderLevel: 30, unitCost: 300, sellingPrice: 600, openingStock: 90 },
  { name: "Simvastatin", genericName: "Simvastatin", form: T, strength: "20mg", unit: PC, reorderLevel: 20, unitCost: 600, sellingPrice: 1100, openingStock: 50 },
  { name: "Prednisone", genericName: "Prednisone", form: T, strength: "20mg", unit: PC, reorderLevel: 20, unitCost: 500, sellingPrice: 1000, openingStock: 40 },

  // ── Vitamins ─────────────────────────────────────────────────────────
  { name: "Ferrous Sulfate + Folic Acid", genericName: "Ferrous Sulfate + Folic Acid", form: T, strength: "60mg/400mcg", unit: PC, reorderLevel: 30, unitCost: 250, sellingPrice: 500, openingStock: 80 },
  { name: "Ascorbic Acid", genericName: "Ascorbic Acid", form: T, strength: "500mg", unit: PC, reorderLevel: 40, unitCost: 150, sellingPrice: 300, openingStock: 120 },
  { name: "Vitamin B Complex", genericName: "Vitamin B Complex", form: T, strength: "B1+B6+B12", unit: PC, reorderLevel: 30, unitCost: 400, sellingPrice: 800, openingStock: 60 },

  // ── Topical / injectable ─────────────────────────────────────────────
  { name: "Povidone Iodine", genericName: "Povidone-Iodine", form: O, strength: "10%", unit: BT, reorderLevel: 10, unitCost: 4000, sellingPrice: 7500, openingStock: 25 },
  { name: "Mupirocin Ointment", genericName: "Mupirocin", form: O, strength: "2%", unit: PC, reorderLevel: 10, unitCost: 12000, sellingPrice: 20000, openingStock: 15 },
  { name: "Hydrocortisone Cream", genericName: "Hydrocortisone", form: O, strength: "1%", unit: PC, reorderLevel: 10, unitCost: 6000, sellingPrice: 10000, openingStock: 20 },
  { name: "Lidocaine", genericName: "Lidocaine", form: I, strength: "2%", unit: VL, reorderLevel: 5, unitCost: 3500, sellingPrice: 6000, openingStock: 12 },
  { name: "Tetanus Toxoid", genericName: "Tetanus Toxoid", form: I, strength: "0.5mL", unit: VL, reorderLevel: 5, unitCost: 12000, sellingPrice: 20000, openingStock: 10 },
]
