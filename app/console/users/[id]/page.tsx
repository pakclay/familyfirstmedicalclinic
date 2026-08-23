import { redirect, notFound } from "next/navigation"
import { auth } from "@/auth"
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
    clinicId: session.user.clinicId,
    holdingCompanyId: session.user.holdingCompanyId,
  }
  const managedUser = await getManagedUserById(actor, id)
  if (!managedUser) notFound()

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-heading font-semibold">{managedUser.name}</h1>
      <p className="text-sm text-muted-foreground">
        {managedUser.email}
        {managedUser.clinicName ? ` · ${managedUser.clinicName}` : ""}
      </p>

      <div className="mt-4">
        <EditUserForm user={managedUser} />
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
