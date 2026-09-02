import { prisma } from "@/lib/db/prisma"
import { runWithRls } from "@/lib/db/rls"
import { isHoldingAdmin, requireHoldingCompanyId, type AbilitySubject } from "@/lib/permissions/ability"
import { ForbiddenError } from "@/lib/permissions/errors"
import type { EditBrandingInput } from "@/lib/validation/branding"

/**
 * The write side of the app-wide product name (lib/branding.ts is the read
 * side). Holding-admin-only for the same reason clinic management is: this
 * renames the product for every branch at once, which is a company-level
 * decision, not something one branch's admin should make for the others.
 *
 * `holding_companies` has no RLS policy of its own — it is absent from the
 * enable_rls_backstop migration, same as `clinics`/`users`/`branches` — so
 * the role check here *is* the enforcement, not a convenience on top of a
 * database guarantee. The action layer refuses non-holding-admins too; both
 * are deliberate (see lib/queries/clinics.ts).
 */
const NOT_A_HOLDING_ADMIN = "Only a holding admin changes the app name."

export async function getBrandName(actor: AbilitySubject): Promise<string | null> {
  if (!isHoldingAdmin(actor)) throw new ForbiddenError(NOT_A_HOLDING_ADMIN)
  const company = await prisma.holdingCompany.findUnique({
    where: { id: requireHoldingCompanyId(actor) },
    select: { brandName: true },
  })
  return company?.brandName ?? null
}

export type UpdateBrandingResult = { ok: true } | { ok: false; error: string }

export async function updateBranding(
  actor: AbilitySubject,
  input: EditBrandingInput
): Promise<UpdateBrandingResult> {
  if (!isHoldingAdmin(actor)) return { ok: false, error: NOT_A_HOLDING_ADMIN }

  // Bounded to the actor's own company rather than the `findFirst` that
  // lib/branding.ts reads with: that one has no session to scope by, this
  // one does, and a write is the wrong place to be loose about which row it
  // lands on even in a data model that only ever holds one.
  const holdingCompanyId = requireHoldingCompanyId(actor)

  // The audit row shares the transaction with the write, so a rejected
  // audit insert takes the rename down with it rather than leaving a
  // company renamed with nobody recorded as having done it. audit_logs
  // *does* have an RLS policy, which is why this needs runWithRls even
  // though holding_companies does not.
  await runWithRls(actor, async (tx) => {
    await tx.holdingCompany.update({
      where: { id: holdingCompanyId },
      data: { brandName: input.brandName },
    })
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        action: "holding_company.brand_updated",
        entityType: "HoldingCompany",
        entityId: holdingCompanyId,
        changes: { brandName: input.brandName },
      },
    })
  })

  return { ok: true }
}
