import { runWithRls } from "@/lib/db/rls"
import { ForbiddenError } from "@/lib/permissions/errors"
import { scopeWhere } from "@/lib/permissions/scoped-queries"
import type { AbilitySubject } from "@/lib/permissions/ability"
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
