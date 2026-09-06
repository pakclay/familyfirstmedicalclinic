import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/db/prisma"
import { assignableRoles, type AbilitySubject } from "@/lib/permissions/ability"
import { listClinics } from "@/lib/queries/clinics"
import { NewUserForm } from "./new-user-form"

export default async function NewUserPage({
  searchParams,
}: {
  searchParams: Promise<{ clinicId?: string; branchId?: string }>
}) {
  const { clinicId, branchId } = await searchParams
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (session.user.role !== "HOLDING_ADMIN" && session.user.role !== "BRANCH_ADMIN" && session.user.role !== "CLINIC_ADMIN") {
    redirect("/console/users")
  }

  const user: AbilitySubject = {
    id: session.user.id,
    role: session.user.role,
    branchId: session.user.branchId,
    clinicId: session.user.clinicId,
    holdingCompanyId: session.user.holdingCompanyId,
  }
  const roles = assignableRoles(user)
  // Only a holding admin can assign CLINIC_ADMIN (assignableRoles), so only
  // a holding admin needs the clinic list — and listClinics throws for anyone
  // else by design, so it is not called for them.
  const clinics = session.user.role === "HOLDING_ADMIN" ? await listClinics(user) : []

  // Only a holding admin ever sees the branch picker (a branch admin is
  // always creating within their own branch, decided server-side in
  // createUser regardless of what a form field might say) — no RLS on
  // `branches` either, but this is a read-only lookup list, not a write.
  // Labeled "Clinic — Branch" since a clinic can have more than one branch
  // now, so the branch name alone may not disambiguate (e.g. two branches
  // both named after their city).
  // `clinicId` narrows the picker when arriving from a clinic's staff
  // section, and `branchId` preselects when arriving from a single branch's.
  // Both are conveniences on a read-only list, never authorization decisions
  // — createUser still decides the branch server-side, so a forged value can
  // only shrink or preselect what this dropdown offers, never widen who can
  // be created or where.
  //
  // Both branchless admin tiers see the picker; each list is bounded to what
  // that tier may create into. `branches` has no RLS, so the holding arm's
  // company bound is what stops this listing every tenant's branches (it
  // had none before), and the clinic arm lists only the actor's own clinic.
  // createUser re-validates the chosen id against the same bound.
  const branchSelect = { id: true, name: true, clinic: { select: { name: true } } } as const
  const branchOrder = [{ clinic: { name: "asc" } }, { name: "asc" }] as const
  const branches =
    session.user.role === "HOLDING_ADMIN"
      ? await prisma.branch.findMany({
          where: {
            isActive: true,
            clinic: { holdingCompanyId: session.user.holdingCompanyId ?? "" },
            ...(clinicId ? { clinicId } : {}),
          },
          select: branchSelect,
          orderBy: [...branchOrder],
        })
      : session.user.role === "CLINIC_ADMIN"
        ? await prisma.branch.findMany({
            where: { isActive: true, clinicId: session.user.clinicId ?? "" },
            select: branchSelect,
            orderBy: [...branchOrder],
          })
        : []

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-heading font-semibold">Add user</h1>
      <div className="mt-4">
        <NewUserForm
          roles={roles}
          branches={branches}
          clinics={clinics}
          showBranchPicker={session.user.role !== "BRANCH_ADMIN"}
          defaultBranchId={branchId && branches.some((b) => b.id === branchId) ? branchId : undefined}
        />
      </div>
    </div>
  )
}
