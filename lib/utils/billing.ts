/**
 * The bill behind a consultation's payment, itemized.
 *
 * One function, used in two places: the consultation form, to show the
 * doctor each line and the total as they work, and saveConsultation, to
 * record what was billed. The screen and the database therefore run the
 * same arithmetic — the form never sends line amounts, only the facts
 * (which medicines, whether to add VAT), and the server recomputes from
 * its own data.
 *
 * Every amount is centavos, integers throughout.
 */

/** Philippine VAT: 12% of the sale (NIRC §106 as amended). */
export const VAT_RATE_PERCENT = 12

export type BillInput = {
  /** The doctor's consultation fee. */
  consultationFee: number
  /** Dispensed-from-stock rows only — a prescribed-only row has no clinic price. */
  medicines: { unitPrice: number; quantity: number }[]
  /** The branch's system fee, or 0 when it doesn't collect one. */
  systemFee: number
  /** Whether the doctor ticked "Add 12% VAT". */
  vat: boolean
}

export type Bill = {
  consultationFee: number
  medicines: number
  systemFee: number
  /** The three lines above, before VAT. */
  subtotal: number
  vat: number
  total: number
}

export function computeBill(input: BillInput): Bill {
  const medicines = input.medicines.reduce((sum, m) => sum + m.unitPrice * m.quantity, 0)
  const subtotal = input.consultationFee + medicines + input.systemFee
  // VAT goes on top of the subtotal, rounded to the centavo, half up —
  // the way a receipt is written by hand.
  const vat = input.vat ? Math.round((subtotal * VAT_RATE_PERCENT) / 100) : 0
  return {
    consultationFee: input.consultationFee,
    medicines,
    systemFee: input.systemFee,
    subtotal,
    vat,
    total: subtotal + vat,
  }
}

/** "₱1,234.50" from centavos, for every screen that prints money. */
export function formatPesos(centavos: number): string {
  return `₱${(centavos / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
