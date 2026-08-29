import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/db/prisma"
import { assignableRoles, type AbilitySubject } from "@/lib/permissions/ability"
import { NewUserForm } from "./new-user-form"

export default async function NewUserPage({
  searchParams,
}: {
  searchParams: Promise<{ clinicId?: string; branchId?: string }>
}) {
  const { clinicId, branchId } = await searchParams
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (session.user.role !== "HOLDING_ADMIN" && session.user.role !== "CLINIC_ADMIN") {
    redirect("/console/users")
  }

  const user: AbilitySubject = {
    id: session.user.id,
    role: session.user.role,
    branchId: session.user.branchId,
    holdingCompanyId: session.user.holdingCompanyId,
  }
  const roles = assignableRoles(user)

  // Only a holding admin ever sees the branch picker (a clinic admin is
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
  const branches =
    session.user.role === "HOLDING_ADMIN"
      ? await prisma.branch.findMany({
          where: { isActive: true, ...(clinicId ? { clinicId } : {}) },
          select: { id: true, name: true, clinic: { select: { name: true } } },
          orderBy: [{ clinic: { name: "asc" } }, { name: "asc" }],
        })
      : []

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-heading font-semibold">Add user</h1>
      <div className="mt-4">
        <NewUserForm
          roles={roles}
          branches={branches}
          showBranchPicker={session.user.role === "HOLDING_ADMIN"}
          defaultBranchId={branchId && branches.some((b) => b.id === branchId) ? branchId : undefined}
        />
      </div>
    </div>
  )
}
