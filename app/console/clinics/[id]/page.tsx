import { redirect, notFound } from "next/navigation"
import { auth } from "@/auth"
import { getClinicById } from "@/lib/queries/clinics"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { EditClinicForm } from "./edit-clinic-form"
import { ClinicDetailActions } from "./clinic-detail-actions"

export default async function EditClinicPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (session.user.role !== "HOLDING_ADMIN") {
    redirect("/console/clinics")
  }

  const { id } = await params
  const actor: AbilitySubject = {
    id: session.user.id,
    role: session.user.role,
    clinicId: session.user.clinicId,
    holdingCompanyId: session.user.holdingCompanyId,
  }
  const clinic = await getClinicById(actor, id)
  if (!clinic) notFound()

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-heading font-semibold">{clinic.name}</h1>
      <p className="text-sm text-muted-foreground">
        /{clinic.slug} · {clinic.city}
        {!clinic.isActive && <span className="ml-2 text-destructive">Inactive</span>}
      </p>

      <div className="mt-4">
        <EditClinicForm clinic={clinic} />
      </div>

      <div className="mt-6 border-t border-border pt-4">
        <ClinicDetailActions clinicId={clinic.id} isActive={clinic.isActive} />
      </div>
    </div>
  )
}
