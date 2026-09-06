import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { runWithRls, appendAuditLog } from "@/lib/db/rls"
import {
  isHoldingAdmin,
  requireBranchId,
  requireHoldingCompanyId,
  isClinicAdmin,
  requireClinicId,
  type AbilitySubject,
} from "@/lib/permissions/ability"
import { ForbiddenError } from "@/lib/permissions/errors"
import { toBranchDTO, type BranchDTO } from "@/lib/dto/branch"
import { toClinicDTO, type ClinicDTO } from "@/lib/dto/clinic"
import type { BranchSettingsInput, CreateBranchInput, EditBranchInput } from "@/lib/validation/branch"
import type { OperatingHours } from "@/lib/validation/operating-hours"

/**
 * Branch management (create/edit/list/deactivate any branch, under any
 * clinic) is holding-admin-only (§4's role table) — a branch admin runs
 * one branch, they don't get to create or reconfigure others. The action
 * layer already refuses anyone else, but every function here re-checks:
 * `branches` has no RLS policy of its own (same reasoning as `clinics`
 * before it — see lib/queries/clinics.ts), so this check *is* the
 * enforcement.
 */
const NOT_A_HOLDING_ADMIN = "Only a holding admin manages branches."

const branchInclude = { clinic: { select: { name: true } } } as const

/**
 * Every mutation below wraps its write **and** its audit_logs row in
 * `runWithRls`. `branches` itself has no policy to satisfy, but
 * `audit_logs` does — its INSERT policy reads app.role/app.branch_id, so a
 * plain `prisma.$transaction` here fails the audit write (and takes the
 * whole transaction down with it) even though the branch write alone would
 * have gone through.
 */

export async function listBranches(actor: AbilitySubject, filter?: { clinicId?: string }): Promise<BranchDTO[]> {
  // Throws rather than returning [] — see lib/queries/clinics.ts's
  // listClinics for the full reasoning (§4.2, and the false-precedent trap
  // that bit the first draft of this pattern).
  if (!isHoldingAdmin(actor) && !isClinicAdmin(actor)) throw new ForbiddenError(NOT_A_HOLDING_ADMIN)
  // Inactive branches included on purpose — the list badges them rather
  // than hiding them, since a deactivated branch is exactly the one an
  // admin needs to find in order to reactivate it.
  //
  // A clinic admin's bound IS the clinicId, so a caller-supplied filter for
  // any other clinic is answered with an empty list rather than spread into
  // the where-clause — spreading would let the filter overwrite the bound,
  // which is the one trap this function has. For a holding admin the bound
  // lives on the `clinic` key and an explicit clinicId only ever narrows.
  // `branches` has no RLS, so these where-clauses are the entire boundary.
  if (isClinicAdmin(actor) && filter?.clinicId && filter.clinicId !== requireClinicId(actor)) return []
  const rows = await prisma.branch.findMany({
    where: isClinicAdmin(actor)
      ? { clinicId: requireClinicId(actor) }
      : {
          clinic: { holdingCompanyId: requireHoldingCompanyId(actor) },
          ...(filter?.clinicId ? { clinicId: filter.clinicId } : {}),
        },
    include: branchInclude,
    orderBy: { name: "asc" },
  })
  return rows.map(toBranchDTO)
}

/**
 * Null means "no such branch" and nothing else. Deliberately *not*
 * getManagedUserById's null-for-both shape: there, both admin roles are
 * legitimate callers and null distinguishes "not one you manage" among
 * them, so collapsing the two cases is real non-enumeration. Here a
 * non-holding-admin has no business calling this at all — that's a role
 * denial, not a missing row, and §4.2 wants it loud.
 */
export async function getBranchById(actor: AbilitySubject, id: string): Promise<BranchDTO | null> {
  if (!isHoldingAdmin(actor) && !isClinicAdmin(actor)) throw new ForbiddenError(NOT_A_HOLDING_ADMIN)
  // findFirst so the actor's bound is part of the match — another tenant's
  // (or, for a clinic admin, another clinic's) branch reads as "no such
  // branch", same shape as getClinicById.
  const row = await prisma.branch.findFirst({
    where: isClinicAdmin(actor)
      ? { id, clinicId: requireClinicId(actor) }
      : { id, clinic: { holdingCompanyId: requireHoldingCompanyId(actor) } },
    include: branchInclude,
  })
  return row ? toBranchDTO(row) : null
}

/** The JSON column takes `Prisma.InputJsonValue`; the validated shape is structurally a JSON object already. */
function toJsonHours(hours: OperatingHours): Prisma.InputJsonValue {
  return hours as Prisma.InputJsonValue
}

export type CreateBranchResult = { ok: true; branch: BranchDTO } | { ok: false; error: string }

export async function createBranch(
  actor: AbilitySubject,
  clinicId: string,
  input: CreateBranchInput
): Promise<CreateBranchResult> {
  // `clinicId` is caller-supplied. A clinic admin may only ever create under
  // its own clinic, so a mismatch is refused as a role error before anything
  // is looked up — the same answer a non-admin gets, so a probe learns
  // nothing about whether the other clinic exists.
  if (isClinicAdmin(actor)) {
    if (clinicId !== requireClinicId(actor)) return { ok: false, error: NOT_A_HOLDING_ADMIN }
  } else if (!isHoldingAdmin(actor)) {
    return { ok: false, error: NOT_A_HOLDING_ADMIN }
  }

  // Bounded to the actor's company: `clinics` has no RLS, so a bare
  // findUnique would let a holding admin create under another tenant's clinic.
  const clinic = await prisma.clinic.findFirst({
    where: isClinicAdmin(actor) ? { id: clinicId } : { id: clinicId, holdingCompanyId: requireHoldingCompanyId(actor) },
  })
  if (!clinic) return { ok: false, error: "Clinic not found." }

  const slug = input.slug.trim().toLowerCase()
  // Checked up front for a friendly message — the unique index is still
  // the real guarantee under a concurrent create, which surfaces as a
  // thrown P2002 rather than a silent duplicate.
  const existing = await prisma.branch.findUnique({ where: { slug } })
  if (existing) return { ok: false, error: "That URL slug is already taken." }

  const created = await runWithRls(actor, async (tx) => {
    const branch = await tx.branch.create({
      data: {
        clinicId,
        name: input.name.trim(),
        slug,
        address: input.address.trim(),
        city: input.city.trim(),
        phone: input.phone.trim(),
        facebookPageUrl: input.facebookPageUrl?.trim() || null,
        timezone: input.timezone.trim(),
        operatingHours: toJsonHours(input.operatingHours),
      },
      include: branchInclude,
    })
    await appendAuditLog(tx, {
      data: {
        branchId: branch.id,
        userId: actor.id,
        action: "branch.created",
        entityType: "Branch",
        entityId: branch.id,
        changes: { name: branch.name, slug: branch.slug, clinicId },
      },
    })
    return branch
  })

  return { ok: true, branch: toBranchDTO(created) }
}

export type ManageBranchResult = { ok: true } | { ok: false; error: string }

export async function updateBranch(
  actor: AbilitySubject,
  id: string,
  input: EditBranchInput
): Promise<ManageBranchResult> {
  // Holding admin only, deliberately: the clinic-level role gets create and
  // deactivate, not reconfiguration of an existing branch's address or hours.
  if (!isHoldingAdmin(actor)) return { ok: false, error: NOT_A_HOLDING_ADMIN }

  // findFirst with the company bound, not findUnique by id: `branches` has no
  // RLS, so the bare lookup this used to be was a latent cross-tenant write.
  const target = await prisma.branch.findFirst({
    where: { id, clinic: { holdingCompanyId: requireHoldingCompanyId(actor) } },
  })
  if (!target) return { ok: false, error: "Branch not found." }

  await runWithRls(actor, async (tx) => {
    // No `slug` here — it's immutable after creation (see editBranchSchema).
    await tx.branch.update({
      where: { id },
      data: {
        name: input.name.trim(),
        address: input.address.trim(),
        city: input.city.trim(),
        phone: input.phone.trim(),
        facebookPageUrl: input.facebookPageUrl?.trim() || null,
        timezone: input.timezone.trim(),
        operatingHours: toJsonHours(input.operatingHours),
      },
    })
    await appendAuditLog(tx, {
      data: {
        branchId: id,
        userId: actor.id,
        action: "branch.updated",
        entityType: "Branch",
        entityId: id,
        changes: { name: input.name.trim() },
      },
    })
  })

  return { ok: true }
}

export async function setBranchActive(
  actor: AbilitySubject,
  id: string,
  isActive: boolean
): Promise<ManageBranchResult> {
  if (!isHoldingAdmin(actor) && !isClinicAdmin(actor)) return { ok: false, error: NOT_A_HOLDING_ADMIN }

  // The lookup carries the actor's bound — clinic for a clinic admin, company
  // for a holding admin — so a branch outside it reads as "not found" rather
  // than being switched off. This used to be a bare findUnique by id, which
  // `branches` having no RLS made a latent cross-tenant write; with the gate
  // widened to a second tier it would have been a cross-clinic kill switch.
  const target = await prisma.branch.findFirst({
    where: {
      id,
      ...(isClinicAdmin(actor)
        ? { clinicId: requireClinicId(actor) }
        : { clinic: { holdingCompanyId: requireHoldingCompanyId(actor) } }),
    },
  })
  if (!target) return { ok: false, error: "Branch not found." }

  await runWithRls(actor, async (tx) => {
    await tx.branch.update({ where: { id }, data: { isActive } })
    await appendAuditLog(tx, {
      data: {
        branchId: id,
        userId: actor.id,
        action: isActive ? "branch.reactivated" : "branch.deactivated",
        entityType: "Branch",
        entityId: id,
      },
    })
  })

  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────────
// Own-branch self-service (branch admin) — §4's "clinic hours" row
// ─────────────────────────────────────────────────────────────────────────

/**
 * Neither function below takes a branch id, by design. §5's hard rule is
 * that clinic/branch scoping comes from the authenticated user's
 * assignment and "never from a client-supplied parameter" — with no id in
 * the signature there is nothing for a caller to pass, so a branch admin
 * cannot reach another branch's row even if the action layer were bypassed
 * entirely.
 *
 * Deliberately separate from listBranches/getBranchById rather than
 * relaxing those: both of them throw for a non-holding-admin, and a
 * branch-settings page wired to them was the exact regression a review of
 * the original clinics feature warned about.
 */
const NOT_A_BRANCH_ADMIN = "Only a branch admin manages their branch's settings."

/**
 * Gated on *having* an own branch rather than on being a branch admin:
 * everything here (name, address, phone, hours) is already on the branch's
 * public `/book/{slug}` page, so it's not privileged reading for anyone
 * assigned to it. Writing it is — that's `updateOwnBranchSettings`, which
 * is clinic-admin only.
 *
 * A holding admin is refused explicitly rather than falling through to
 * `requireBranchId`, whose null-branchId throw is a plain Error meaning
 * "the programmer forgot to branch on isHoldingAdmin" — that would surface
 * as a 500. This is a role boundary, so it gets the 403-equivalent.
 */
export async function getOwnBranch(actor: AbilitySubject): Promise<BranchDTO> {
  if (isHoldingAdmin(actor)) {
    throw new ForbiddenError("A holding admin has no single branch — use the clinics list instead.")
  }
  // Same reasoning, one tier down: a clinic admin is branchless, and letting
  // it fall through to requireBranchId would surface as a 500 — the exact
  // thing the comment above exists to prevent.
  if (isClinicAdmin(actor)) {
    throw new ForbiddenError("A clinic admin has no single branch — use the clinic's branch list instead.")
  }
  const branchId = requireBranchId(actor)
  const row = await prisma.branch.findUniqueOrThrow({ where: { id: branchId }, include: branchInclude })
  return toBranchDTO(row)
}

/**
 * A clinic admin's own clinic, for the /console/clinic surface. No id
 * parameter, for the same reason getOwnBranch has none: §5's rule is that
 * scoping comes from the authenticated user's assignment and "never from a
 * client-supplied parameter", and with no id in the signature there is
 * nothing for a caller to pass. Only the clinic-level role has an own
 * clinic; everyone else is refused as a role error, not a missing row.
 */
export async function getOwnClinic(actor: AbilitySubject): Promise<ClinicDTO> {
  if (!isClinicAdmin(actor)) {
    throw new ForbiddenError("Only a clinic admin has a single clinic of their own.")
  }
  const row = await prisma.clinic.findUniqueOrThrow({ where: { id: requireClinicId(actor) } })
  return toClinicDTO(row)
}

export async function updateOwnBranchSettings(
  actor: AbilitySubject,
  input: BranchSettingsInput
): Promise<ManageBranchResult> {
  if (actor.role !== "BRANCH_ADMIN") return { ok: false, error: NOT_A_BRANCH_ADMIN }
  const branchId = requireBranchId(actor)

  await runWithRls(actor, async (tx) => {
    // Fields listed one by one rather than spreading `input`: this is the
    // privilege boundary, and a spread would quietly start writing any
    // field a future edit adds to the settings schema.
    await tx.branch.update({
      where: { id: branchId },
      data: {
        address: input.address.trim(),
        city: input.city.trim(),
        phone: input.phone.trim(),
        facebookPageUrl: input.facebookPageUrl?.trim() || null,
        operatingHours: toJsonHours(input.operatingHours),
      },
    })
    await appendAuditLog(tx, {
      data: {
        branchId,
        userId: actor.id,
        action: "branch.settings_updated",
        entityType: "Branch",
        entityId: branchId,
      },
    })
  })

  return { ok: true }
}
