/**
 * Payment DTO. There is no "redacted" variant — a role that can't see
 * money doesn't get a Payment object with amountCentavos blanked out, it
 * gets denied before this function is ever called (see
 * lib/queries/payments.ts). This exists so the one code path allowed to
 * read payments (OWNER / BRANCH_MANAGER) still goes through an explicit
 * allowlist rather than a raw Prisma row.
 */

export type PaymentForDTO = {
  id: string
  patientId: string
  amountCentavos: number
  method: string
  referenceNo: string | null
  receivedAt: Date
  isVoided: boolean
}

export function toPaymentDTO(payment: PaymentForDTO) {
  return {
    id: payment.id,
    patientId: payment.patientId,
    amountCentavos: payment.amountCentavos,
    method: payment.method,
    referenceNo: payment.referenceNo,
    receivedAt: payment.receivedAt,
    isVoided: payment.isVoided,
  }
}
