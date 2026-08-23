import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { runWithRls } from "@/lib/db/rls"
import { isHoldingAdmin, requireClinicId, type AbilitySubject } from "@/lib/permissions/ability"
import { ForbiddenError } from "@/lib/permissions/errors"
import { toClinicDTO, type ClinicDTO } from "@/lib/dto/clinic"
import type { ClinicSettingsInput, CreateClinicInput, EditClinicInput, OperatingHours } from "@/lib/validation/clinic"

/**
 * Clinic management is holding-admin-only (§4's role table) — a clinic
 * admin runs a clinic, they don't get to create or rename one. The action
 * layer already refuses anyone else, but every function here re-checks:
 * `clinics` has no RLS policy of its own (it's absent from the
 * enable_rls_backstop migration, same as `users` and `doctors`), so this
 * check *is* the enforcement, and keeping it in the query layer is what
 * makes it directly testable without a fake session.
 */
const NOT_A_HOLDING_ADMIN = "Only a holding admin manages clinics."

/**
 * Every mutation below wraps its write **and** its audit_logs row in
 * `runWithRls`. `clinics` itself has no policy to satisfy, but
 * `audit_logs` does — its INSERT policy reads app.role/app.clinic_id, so a
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
  // holding-admin-only read. (`listUsers` looks like a counter-example but
  // isn't: it has no role gate at all — it clinic-scopes its `where`, so
  // every caller legitimately gets rows.)
  if (!isHoldingAdmin(actor)) throw new ForbiddenError(NOT_A_HOLDING_ADMIN)
  // Inactive clinics included on purpose — the list badges them rather
  // than hiding them, since a deactivated clinic is exactly the one an
  // admin needs to find in order to reactivate it.
  const rows = await prisma.clinic.findMany({ orderBy: { name: "asc" } })
  return rows.map(toClinicDTO)
}

/**
 * Null means "no such clinic" and nothing else. Deliberately *not*
 * getManagedUserById's null-for-both shape: there, both admin roles are
 * legitimate callers and null distinguishes "not one you manage" among
 * them, so collapsing the two cases is real non-enumeration. Here a
 * non-holding-admin has no business calling this at all — that's a role
 * denial, not a missing row, and §4.2 wants it loud.
 */
export async function getClinicById(actor: AbilitySubject, id: string): Promise<ClinicDTO | null> {
  if (!isHoldingAdmin(actor)) throw new ForbiddenError(NOT_A_HOLDING_ADMIN)
  const row = await prisma.clinic.findUnique({ where: { id } })
  return row ? toClinicDTO(row) : null
}

/** The JSON column takes `Prisma.InputJsonValue`; the validated shape is structurally a JSON object already. */
function toJsonHours(hours: OperatingHours): Prisma.InputJsonValue {
  return hours as Prisma.InputJsonValue
}

export type CreateClinicResult = { ok: true; clinic: ClinicDTO } | { ok: false; error: string }

export async function createClinic(actor: AbilitySubject, input: CreateClinicInput): Promise<CreateClinicResult> {
  if (!isHoldingAdmin(actor)) return { ok: false, error: NOT_A_HOLDING_ADMIN }

  const slug = input.slug.trim().toLowerCase()
  // Checked up front for a friendly message — the unique index is still
  // the real guarantee under a concurrent create, which surfaces as a
  // thrown P2002 rather than a silent duplicate.
  const existing = await prisma.clinic.findUnique({ where: { slug } })
  if (existing) return { ok: false, error: "That URL slug is already taken." }

  const created = await runWithRls(actor, async (tx) => {
    const clinic = await tx.clinic.create({
      data: {
        holdingCompanyId: actor.holdingCompanyId,
        name: input.name.trim(),
        slug,
        address: input.address.trim(),
        city: input.city.trim(),
        phone: input.phone.trim(),
        facebookPageUrl: input.facebookPageUrl?.trim() || null,
        timezone: input.timezone.trim(),
        operatingHours: toJsonHours(input.operatingHours),
      },
    })
    await tx.auditLog.create({
      data: {
        clinicId: clinic.id,
        userId: actor.id,
        action: "clinic.created",
        entityType: "Clinic",
        entityId: clinic.id,
        changes: { name: clinic.name, slug: clinic.slug },
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
    // No `slug` here — it's immutable after creation (see editClinicSchema).
    await tx.clinic.update({
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
    await tx.auditLog.create({
      data: {
        clinicId: id,
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

// ─────────────────────────────────────────────────────────────────────────
// Own-clinic self-service (clinic admin) — §4's "clinic hours" row
// ─────────────────────────────────────────────────────────────────────────

/**
 * Neither function below takes a clinic id, by design. §5's hard rule is
 * that clinic scoping comes from the authenticated user's assignment and
 * "never from a client-supplied parameter" — with no id in the signature
 * there is nothing for a caller to pass, so a clinic admin cannot reach
 * another clinic's row even if the action layer were bypassed entirely.
 *
 * Deliberately separate from listClinics/getClinicById rather than
 * relaxing those: both of them throw for a non-holding-admin, and a
 * clinic-settings page wired to them was the exact regression a review of
 * the clinics feature warned about.
 */
const NOT_A_CLINIC_ADMIN = "Only a clinic admin manages their clinic's settings."

/**
 * Gated on *having* an own clinic rather than on being a clinic admin:
 * everything here (name, address, phone, hours) is already on the clinic's
 * public `/book/{slug}` page, so it's not privileged reading for anyone
 * assigned to it. Writing it is — that's `updateOwnClinicSettings`, which
 * is clinic-admin only.
 *
 * A holding admin is refused explicitly rather than falling through to
 * `requireClinicId`, whose null-clinicId throw is a plain Error meaning
 * "the programmer forgot to branch on isHoldingAdmin" — that would surface
 * as a 500. This is a role boundary, so it gets the 403-equivalent.
 */
export async function getOwnClinic(actor: AbilitySubject): Promise<ClinicDTO> {
  if (isHoldingAdmin(actor)) {
    throw new ForbiddenError("A holding admin has no single clinic — use the clinics list instead.")
  }
  const clinicId = requireClinicId(actor)
  const row = await prisma.clinic.findUniqueOrThrow({ where: { id: clinicId } })
  return toClinicDTO(row)
}

export async function updateOwnClinicSettings(
  actor: AbilitySubject,
  input: ClinicSettingsInput
): Promise<ManageClinicResult> {
  if (actor.role !== "CLINIC_ADMIN") return { ok: false, error: NOT_A_CLINIC_ADMIN }
  const clinicId = requireClinicId(actor)

  await runWithRls(actor, async (tx) => {
    // Fields listed one by one rather than spreading `input`: this is the
    // privilege boundary, and a spread would quietly start writing any
    // field a future edit adds to the settings schema.
    await tx.clinic.update({
      where: { id: clinicId },
      data: {
        address: input.address.trim(),
        city: input.city.trim(),
        phone: input.phone.trim(),
        facebookPageUrl: input.facebookPageUrl?.trim() || null,
        operatingHours: toJsonHours(input.operatingHours),
      },
    })
    await tx.auditLog.create({
      data: {
        clinicId,
        userId: actor.id,
        action: "clinic.settings_updated",
        entityType: "Clinic",
        entityId: clinicId,
      },
    })
  })

  return { ok: true }
}

export async function setClinicActive(
  actor: AbilitySubject,
  id: string,
  isActive: boolean
): Promise<ManageClinicResult> {
  if (!isHoldingAdmin(actor)) return { ok: false, error: NOT_A_HOLDING_ADMIN }

  const target = await prisma.clinic.findUnique({ where: { id } })
  if (!target) return { ok: false, error: "Clinic not found." }

  await runWithRls(actor, async (tx) => {
    await tx.clinic.update({ where: { id }, data: { isActive } })
    await tx.auditLog.create({
      data: {
        clinicId: id,
        userId: actor.id,
        action: isActive ? "clinic.reactivated" : "clinic.deactivated",
        entityType: "Clinic",
        entityId: id,
      },
    })
  })

  return { ok: true }
}
