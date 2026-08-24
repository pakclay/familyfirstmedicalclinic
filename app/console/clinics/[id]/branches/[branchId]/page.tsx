import { redirect, notFound } from "next/navigation"
import { auth } from "@/auth"
import { getClinicById } from "@/lib/queries/clinics"
import { getBranchById } from "@/lib/queries/branches"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { EditBranchForm } from "./edit-branch-form"
import { BranchDetailActions } from "./branch-detail-actions"

export default async function BranchDetailPage({ params }: { params: Promise<{ id: string; branchId: string }> }) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (session.user.role !== "HOLDING_ADMIN") {
    redirect("/console/clinics")
  }

  const { id: clinicId, branchId } = await params
  const actor: AbilitySubject = {
    id: session.user.id,
    role: session.user.role,
    branchId: session.user.branchId,
    holdingCompanyId: session.user.holdingCompanyId,
  }
  const clinic = await getClinicById(actor, clinicId)
  if (!clinic) notFound()
  const branch = await getBranchById(actor, branchId)
  if (!branch || branch.clinicId !== clinicId) notFound()

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-heading font-semibold">{branch.name}</h1>
      <p className="text-sm text-muted-foreground">
        {clinic.name} · /{branch.slug} · {branch.city}
        {!branch.isActive && <span className="ml-2 text-destructive">Inactive</span>}
      </p>

      <div className="mt-4">
        <EditBranchForm clinicId={clinicId} branch={branch} />
      </div>

      <div className="mt-6 border-t border-border pt-4">
        <BranchDetailActions clinicId={clinicId} branchId={branch.id} isActive={branch.isActive} />
      </div>
    </div>
  )
}
