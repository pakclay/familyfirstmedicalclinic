import { redirect, notFound } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/db/prisma"
import { getManagedUserById } from "@/lib/queries/users"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { EditUserForm } from "./edit-user-form"
import { UserDetailActions } from "./user-detail-actions"

export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (session.user.role !== "HOLDING_ADMIN" && session.user.role !== "CLINIC_ADMIN") {
    redirect("/console/users")
  }

  const { id } = await params
  const actor: AbilitySubject = {
    id: session.user.id,
    role: session.user.role,
    branchId: session.user.branchId,
    holdingCompanyId: session.user.holdingCompanyId,
  }
  const managedUser = await getManagedUserById(actor, id)
  if (!managedUser) notFound()

  // Only a holding admin may move someone between branches (updateUser
  // enforces that regardless of what the form posts), and a holding admin's
  // own account has no branch to move — so the picker is fetched for nobody
  // else. Same "Clinic — Branch" labelling as the create form, since branch
  // names alone can repeat across clinics.
  const canMoveBranch = session.user.role === "HOLDING_ADMIN" && managedUser.role !== "HOLDING_ADMIN"
  const branches = canMoveBranch
    ? await prisma.branch.findMany({
        where: { isActive: true },
        select: { id: true, name: true, clinic: { select: { name: true } } },
        orderBy: [{ clinic: { name: "asc" } }, { name: "asc" }],
      })
    : []

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-heading font-semibold">{managedUser.name}</h1>
      <p className="text-sm text-muted-foreground">
        {managedUser.email}
        {managedUser.branchName ? ` · ${managedUser.branchName}` : ""}
      </p>

      <div className="mt-4">
        <EditUserForm user={managedUser} branches={branches} showBranchPicker={canMoveBranch} />
      </div>

      <div className="mt-6 border-t border-border pt-4">
        <UserDetailActions
          userId={managedUser.id}
          isActive={managedUser.isActive}
          isLockedOut={managedUser.isLockedOut}
          isSelf={managedUser.id === actor.id}
        />
      </div>
    </div>
  )
}
