"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { requireClinicId, type AbilitySubject } from "@/lib/permissions/ability"
import { ForbiddenError } from "@/lib/permissions/errors"
import { createBranchSchema } from "@/lib/validation/branch"
import { createBranch, setBranchActive, type CreateBranchResult, type ManageBranchResult } from "@/lib/queries/branches"

/**
 * Clinic admin only. Deliberately a separate action file from
 * app/console/clinics/actions.ts rather than a relaxed gate there: that
 * file's one `actingUser()` also guards createClinicAction and
 * updateClinicAction — clinic *creation*, which this role must never reach.
 * Two gates, two files, nothing shared that could be loosened by accident.
 *
 * Neither action takes a clinic id. §5's rule is that scoping comes from
 * the authenticated user's assignment and "never from a client-supplied
 * parameter"; with no id in the signature there is nothing for a caller to
 * pass, so a clinic admin cannot reach another clinic's branches even if
 * the page layer were bypassed. lib/queries/branches.ts re-checks anyway.
 */
async function actingUser(): Promise<AbilitySubject> {
  const session = await auth()
  if (!session?.user) throw new ForbiddenError("Not signed in")
  if (session.user.role !== "CLINIC_ADMIN") {
    throw new ForbiddenError("Only a clinic admin manages their clinic's branches here")
  }
  return {
    id: session.user.id,
    role: session.user.role,
    branchId: session.user.branchId,
    clinicId: session.user.clinicId,
    holdingCompanyId: session.user.holdingCompanyId,
  }
}

const ROUTE = "/console/clinic"

export async function createOwnClinicBranchAction(formData: Record<string, unknown>): Promise<CreateBranchResult> {
  const user = await actingUser()
  const parsed = createBranchSchema.safeParse(formData)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form for errors." }
  }
  const result = await createBranch(user, requireClinicId(user), parsed.data)
  if (result.ok) revalidatePath(ROUTE)
  return result
}

export async function setOwnClinicBranchActiveAction(id: string, isActive: boolean): Promise<ManageBranchResult> {
  const user = await actingUser()
  const result = await setBranchActive(user, id, isActive)
  if (result.ok) revalidatePath(ROUTE)
  return result
}
