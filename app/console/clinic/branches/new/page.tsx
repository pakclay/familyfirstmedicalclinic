import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getOwnClinic } from "@/lib/queries/branches"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { NewBranchForm } from "./new-branch-form"

export default async function NewOwnClinicBranchPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (session.user.role !== "CLINIC_ADMIN") {
    redirect("/console/clinic")
  }

  const actor: AbilitySubject = {
    id: session.user.id,
    role: session.user.role,
    branchId: session.user.branchId,
    clinicId: session.user.clinicId,
    holdingCompanyId: session.user.holdingCompanyId,
  }
  // Session-derived — there is no clinic id in this URL to trust or validate.
  const clinic = await getOwnClinic(actor)

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-heading font-semibold">Add branch</h1>
      <p className="text-sm text-muted-foreground">Under {clinic.name}</p>
      <div className="mt-4">
        <NewBranchForm />
      </div>
    </div>
  )
}
