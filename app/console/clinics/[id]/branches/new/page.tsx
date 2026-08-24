import { redirect, notFound } from "next/navigation"
import { auth } from "@/auth"
import { getClinicById } from "@/lib/queries/clinics"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { NewBranchForm } from "./new-branch-form"

export default async function NewBranchPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (session.user.role !== "HOLDING_ADMIN") {
    redirect("/console/clinics")
  }

  const { id: clinicId } = await params
  const actor: AbilitySubject = {
    id: session.user.id,
    role: session.user.role,
    branchId: session.user.branchId,
    holdingCompanyId: session.user.holdingCompanyId,
  }
  const clinic = await getClinicById(actor, clinicId)
  if (!clinic) notFound()

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-heading font-semibold">Add branch</h1>
      <p className="text-sm text-muted-foreground">Under {clinic.name}</p>
      <div className="mt-4">
        <NewBranchForm clinicId={clinicId} />
      </div>
    </div>
  )
}
