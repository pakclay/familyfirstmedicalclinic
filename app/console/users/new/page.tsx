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
    clinicId: session.user.clinicId,
    holdingCompanyId: session.user.holdingCompanyId,
  }
  const roles = assignableRoles(user)

  // Only a holding admin ever sees the clinic picker (a clinic admin is
  // always creating within their own clinic, decided server-side in
  // createUser regardless of what a form field might say) — no RLS on
  // `clinics` either, but this is a read-only lookup list, not a write.
  const clinics =
    session.user.role === "HOLDING_ADMIN"
      ? await prisma.clinic.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })
      : []

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-heading font-semibold">Add user</h1>
      <div className="mt-4">
        <NewUserForm roles={roles} clinics={clinics} showClinicPicker={session.user.role === "HOLDING_ADMIN"} />
      </div>
    </div>
  )
}
