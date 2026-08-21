import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getConsultationScreenData } from "@/lib/queries/consultations"
import { ForbiddenError } from "@/lib/permissions/errors"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { ConsultationForm } from "./consultation-form"

export default async function ConsultationPage({ params }: { params: Promise<{ queueEntryId: string }> }) {
  const { queueEntryId } = await params
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (session.user.role !== "DOCTOR") redirect("/")

  const user: AbilitySubject = {
    id: session.user.id,
    role: session.user.role,
    clinicId: session.user.clinicId,
    holdingCompanyId: session.user.holdingCompanyId,
  }

  let data
  try {
    data = await getConsultationScreenData(user, queueEntryId)
  } catch (err) {
    if (err instanceof ForbiddenError) redirect("/doctor/queue")
    throw err
  }

  return (
    <div className="mx-auto max-w-2xl p-4">
      <ConsultationForm data={data} />
    </div>
  )
}
