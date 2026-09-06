import { describe, expect, it } from "vitest"
import { computeBill, formatPesos, VAT_RATE_PERCENT } from "@/lib/utils/billing"

describe("computeBill", () => {
  it("adds the consultation fee, each dispensed line at price × quantity, and the system fee", () => {
    const bill = computeBill({
      consultationFee: 50000,
      medicines: [
        { unitPrice: 300, quantity: 10 },
        { unitPrice: 1250, quantity: 2 },
      ],
      systemFee: 2000,
      vat: false,
    })
    expect(bill).toEqual({
      consultationFee: 50000,
      medicines: 5500,
      systemFee: 2000,
      subtotal: 57500,
      vat: 0,
      total: 57500,
    })
  })

  it("puts 12% VAT on top of the subtotal when asked, and nothing otherwise", () => {
    expect(VAT_RATE_PERCENT).toBe(12)
    const withVat = computeBill({ consultationFee: 50000, medicines: [], systemFee: 0, vat: true })
    expect(withVat.vat).toBe(6000)
    expect(withVat.total).toBe(56000)
    const without = computeBill({ consultationFee: 50000, medicines: [], systemFee: 0, vat: false })
    expect(without.vat).toBe(0)
    expect(without.total).toBe(50000)
  })

  it("rounds VAT to the centavo, half up, so the total is always a whole number of centavos", () => {
    // 33 centavos × 12% = 3.96 → 4
    expect(computeBill({ consultationFee: 33, medicines: [], systemFee: 0, vat: true }).vat).toBe(4)
    // 29 centavos × 12% = 3.48 → 3
    expect(computeBill({ consultationFee: 29, medicines: [], systemFee: 0, vat: true }).vat).toBe(3)
    // 12.5 exactly (from 104.1666… × 12) — 1 041 667 × 12 / 100 = 125 000.04 → 125 000; use a true .5:
    // 4 × 12 / 100 = 0.48 → 0; 21 × 12 / 100 = 2.52 → 3
    expect(computeBill({ consultationFee: 21, medicines: [], systemFee: 0, vat: true }).vat).toBe(3)
    const bill = computeBill({ consultationFee: 12345, medicines: [{ unitPrice: 7, quantity: 3 }], systemFee: 1, vat: true })
    expect(Number.isInteger(bill.vat)).toBe(true)
    expect(bill.total).toBe(bill.subtotal + bill.vat)
  })

  it("a bill with nothing on it is zero, not NaN", () => {
    expect(computeBill({ consultationFee: 0, medicines: [], systemFee: 0, vat: true })).toEqual({
      consultationFee: 0,
      medicines: 0,
      systemFee: 0,
      subtotal: 0,
      vat: 0,
      total: 0,
    })
  })
})

describe("formatPesos", () => {
  it("prints centavos as pesos with two decimals and thousands separators", () => {
    expect(formatPesos(0)).toBe("₱0.00")
    expect(formatPesos(50000)).toBe("₱500.00")
    expect(formatPesos(123456789)).toBe("₱1,234,567.89")
    expect(formatPesos(5)).toBe("₱0.05")
  })
})
