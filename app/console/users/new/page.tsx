import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/db/prisma"
import { assignableRoles, type AbilitySubject } from "@/lib/permissions/ability"
import { NewUserForm } from "./new-user-form"

export default async function NewUserPage() {
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
  const branches =
    session.user.role === "HOLDING_ADMIN"
      ? await prisma.branch.findMany({
          where: { isActive: true },
          select: { id: true, name: true, clinic: { select: { name: true } } },
          orderBy: [{ clinic: { name: "asc" } }, { name: "asc" }],
        })
      : []

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-heading font-semibold">Add user</h1>
      <div className="mt-4">
        <NewUserForm roles={roles} branches={branches} showBranchPicker={session.user.role === "HOLDING_ADMIN"} />
      </div>
    </div>
  )
}
