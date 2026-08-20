"use server"

import { requireSession } from "@/lib/auth/guards"
import { listPaymentsFor, recordPaymentFor, type RecordPaymentInput } from "@/lib/queries/payments"

export async function listPayments(branchId: string) {
  const user = await requireSession()
  return listPaymentsFor(user, branchId)
}

export async function recordPayment(input: RecordPaymentInput) {
  const user = await requireSession()
  return recordPaymentFor(user, input)
}
