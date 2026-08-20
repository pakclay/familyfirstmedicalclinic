import { randomUUID } from "node:crypto"
import type { Prisma, PaymentMethod } from "@prisma/client"
import { runWithRls } from "@/lib/db/rls"
import { ForbiddenError } from "@/lib/permissions/errors"
import { scopeWhere } from "@/lib/permissions/scoped-queries"
import { canAccess, type AbilitySubject } from "@/lib/permissions/ability"
import { toPaymentDTO } from "@/lib/dto/payment"

/**
 * The concrete resource behind §4.2's hard rule and the Phase 2 "done
 * when": THERAPIST, DOCTOR, FRONT_DESK, and MARKETING all have `read:
 * none` on `payments` in the ability matrix — this throws ForbiddenError
 * for every one of them before a single row is fetched, and the RLS
 * policy on the Payment table denies them a second time even if this
 * check were ever bypassed or miswired.
 *
 * Payment recording itself (FRONT_DESK, write-only, §4.1's
 * "record only, cannot view reports") lands with the Phase 3 scheduling
 * work this reads for — this is the read side, built now so the
 * permission layer has a real money resource to be tested against.
 */
export async function listPaymentsFor(user: AbilitySubject, branchId: string) {
  const where = scopeWhere(user, "payments", "read", { branchField: "branchId" })
  if (!where) throw new ForbiddenError("Your role cannot view payment records")

  const rows = await runWithRls(user, (tx) =>
    tx.payment.findMany({
      where: { AND: [where, { branchId, deletedAt: null }] },
      orderBy: { receivedAt: "desc" },
    })
  )

  return rows.map(toPaymentDTO)
}

export type RecordPaymentInput = {
  patientId: string
  branchId: string
  amountCentavos: number
  method: PaymentMethod
  referenceNo?: string
  appointmentId?: string
  patientPackageId?: string
}

/**
 * §4.1: FRONT_DESK can record a payment but never read it back — Payment's
 * RLS SELECT policy deliberately excludes FRONT_DESK. That's a real
 * conflict with Prisma's `.create()`, which always does `INSERT ...
 * RETURNING *`: Postgres RLS requires the SELECT policy to pass for a
 * RETURNING clause too, so `.create()` fails for FRONT_DESK even though
 * the INSERT itself is allowed (confirmed by testing a plain INSERT vs.
 * one with RETURNING directly against the RLS policy — see DECISIONS.md).
 * Using a raw INSERT with no RETURNING sidesteps that entirely, and the
 * DTO is built from the input we already have rather than read back.
 */
export async function recordPaymentFor(user: AbilitySubject, input: RecordPaymentInput) {
  if (!canAccess(user, "payments", "write")) throw new ForbiddenError("Your role cannot record payments")
  if (user.role !== "OWNER" && user.homeBranchId !== input.branchId) {
    throw new ForbiddenError("Cannot record a payment for another branch")
  }
  if (input.amountCentavos <= 0) throw new Error("Payment amount must be greater than zero")

  const id = randomUUID()
  const receivedAt = new Date()

  await runWithRls(user, (tx) => insertPaymentNoReturning(tx, { id, receivedAt, receivedById: user.id, ...input }))

  return toPaymentDTO({
    id,
    patientId: input.patientId,
    amountCentavos: input.amountCentavos,
    method: input.method,
    referenceNo: input.referenceNo ?? null,
    receivedAt,
    isVoided: false,
  })
}

/** Shared by recordPaymentFor and sellPackageFor (packages.ts) — see the
 * comment above for why this avoids Prisma's `.create()`. */
export async function insertPaymentNoReturning(
  tx: Prisma.TransactionClient,
  data: {
    id: string
    patientId: string
    branchId: string
    amountCentavos: number
    method: PaymentMethod
    referenceNo?: string
    appointmentId?: string
    patientPackageId?: string
    receivedById: string
    receivedAt: Date
  }
) {
  await tx.$executeRaw`
    INSERT INTO "Payment" (
      id, "patientId", "branchId", "amountCentavos", method, "referenceNo",
      "appointmentId", "patientPackageId", "receivedById", "receivedAt", "createdById", "createdAt", "updatedAt"
    ) VALUES (
      ${data.id}, ${data.patientId}, ${data.branchId}, ${data.amountCentavos}, ${data.method}::"PaymentMethod",
      ${data.referenceNo ?? null}, ${data.appointmentId ?? null}, ${data.patientPackageId ?? null},
      ${data.receivedById}, ${data.receivedAt}, ${data.receivedById}, now(), now()
    )
  `
}
