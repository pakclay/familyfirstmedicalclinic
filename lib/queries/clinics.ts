import { prisma } from "@/lib/db/prisma"
import { runWithRls } from "@/lib/db/rls"
import { isHoldingAdmin, requireHoldingCompanyId, type AbilitySubject } from "@/lib/permissions/ability"
import { ForbiddenError } from "@/lib/permissions/errors"
import { toClinicDTO, type ClinicDTO } from "@/lib/dto/clinic"
import type { CreateClinicInput, EditClinicInput } from "@/lib/validation/clinic"

/**
 * Clinic management is holding-admin-only (§4's role table) — a clinic
 * admin runs one branch, they don't get to create or rename the
 * organization above it. The action layer already refuses anyone else,
 * but every function here re-checks: `clinics` has no RLS policy of its
 * own (it's absent from the enable_rls_backstop migration, same as
 * `users`/`doctors`/`branches`), so this check *is* the enforcement, and
 * keeping it in the query layer is what makes it directly testable
 * without a fake session.
 *
 * Clinic is purely organizational after the branch-hierarchy migration —
 * see DECISIONS.md. Everything operational (slug, address, hours,
 * isActive, patients, queue, ...) lives on Branch instead
 * (lib/queries/branches.ts).
 */
const NOT_A_HOLDING_ADMIN = "Only a holding admin manages clinics."

/**
 * Every mutation below wraps its write **and** its audit_logs row in
 * `runWithRls`. `clinics` itself has no policy to satisfy, but
 * `audit_logs` does — its INSERT policy reads app.role/app.branch_id, so a
 * plain `prisma.$transaction` here fails the audit write (and takes the
 * whole transaction down with it) even though the clinic write alone would
 * have gone through.
 */

export async function listClinics(actor: AbilitySubject): Promise<ClinicDTO[]> {
  // Throws rather than returning [] — §4.2 (see lib/permissions/errors.ts)
  // requires a forbidden read to fail as a 403-equivalent, never to
  // silently degrade to an empty list, so a future caller wired up behind
  // a looser gate fails loudly instead of rendering a plausible "No
  // clinics yet." Matches getHoldingConsolidatedReport, the other
  // holding-admin-only read.
  if (!isHoldingAdmin(actor)) throw new ForbiddenError(NOT_A_HOLDING_ADMIN)
  // Bounded to the actor's own company. `clinics` has no RLS, so this
  // predicate is the entire tenant boundary — without it a holding admin
  // reads every company's clinics. See requireHoldingCompanyId.
  const rows = await prisma.clinic.findMany({
    where: { holdingCompanyId: requireHoldingCompanyId(actor) },
    orderBy: { name: "asc" },
  })
  return rows.map(toClinicDTO)
}

/**
 * Null means "no such clinic" and nothing else — a non-holding-admin has
 * no business calling this at all, which is a role denial (§4.2 wants it
 * loud), not a missing row.
 */
export async function getClinicById(actor: AbilitySubject, id: string): Promise<ClinicDTO | null> {
  if (!isHoldingAdmin(actor)) throw new ForbiddenError(NOT_A_HOLDING_ADMIN)
  // findFirst rather than findUnique so the company bound is part of the
  // match: another tenant's clinic reads as "no such clinic", which is the
  // honest answer to give an admin who has no business seeing it.
  const row = await prisma.clinic.findFirst({
    where: { id, holdingCompanyId: requireHoldingCompanyId(actor) },
  })
  return row ? toClinicDTO(row) : null
}

export type CreateClinicResult = { ok: true; clinic: ClinicDTO } | { ok: false; error: string }

export async function createClinic(actor: AbilitySubject, input: CreateClinicInput): Promise<CreateClinicResult> {
  if (!isHoldingAdmin(actor)) return { ok: false, error: NOT_A_HOLDING_ADMIN }

  const created = await runWithRls(actor, async (tx) => {
    const clinic = await tx.clinic.create({
      data: {
        holdingCompanyId: actor.holdingCompanyId,
        name: input.name.trim(),
      },
    })
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        action: "clinic.created",
        entityType: "Clinic",
        entityId: clinic.id,
        changes: { name: clinic.name },
      },
    })
    return clinic
  })

  return { ok: true, clinic: toClinicDTO(created) }
}

export type ManageClinicResult = { ok: true } | { ok: false; error: string }

export async function updateClinic(
  actor: AbilitySubject,
  id: string,
  input: EditClinicInput
): Promise<ManageClinicResult> {
  if (!isHoldingAdmin(actor)) return { ok: false, error: NOT_A_HOLDING_ADMIN }

  const target = await prisma.clinic.findUnique({ where: { id } })
  if (!target) return { ok: false, error: "Clinic not found." }

  await runWithRls(actor, async (tx) => {
    await tx.clinic.update({ where: { id }, data: { name: input.name.trim() } })
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        action: "clinic.updated",
        entityType: "Clinic",
        entityId: id,
        changes: { name: input.name.trim() },
      },
    })
  })

  return { ok: true }
}
