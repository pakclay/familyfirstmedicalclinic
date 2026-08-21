import { redirect, notFound, forbidden } from "next/navigation"
import { auth } from "@/auth"
import { getPatientById } from "@/lib/queries/patients"
import { ForbiddenError } from "@/lib/permissions/errors"
import type { AbilitySubject } from "@/lib/permissions/ability"

export default async function PatientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  if (!session?.user) redirect("/login")

  const user: AbilitySubject = {
    id: session.user.id,
    role: session.user.role,
    clinicId: session.user.clinicId,
    holdingCompanyId: session.user.holdingCompanyId,
  }

  let patient
  try {
    patient = await getPatientById(user, id)
  } catch (err) {
    if (err instanceof ForbiddenError) forbidden()
    throw err
  }
  if (!patient) notFound()

  return (
    <div>
      <h1 className="text-2xl font-heading font-semibold">
        {patient.lastName}, {patient.firstName} {patient.middleName ?? ""}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {patient.age}y · {patient.sex === "MALE" ? "Male" : "Female"} · {patient.phone}
        {patient.isMinor && " · Minor (guardian required)"}
      </p>

      <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
        <div>
          <dt className="text-muted-foreground">Address</dt>
          <dd>{patient.address}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Email</dt>
          <dd>{patient.email ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Emergency contact</dt>
          <dd>
            {patient.emergencyContactName} · {patient.emergencyContactPhone}
          </dd>
        </div>
        {patient.isMinor && (
          <div>
            <dt className="text-muted-foreground">Guardian</dt>
            <dd>
              {patient.guardianName ?? "—"} · {patient.guardianPhone ?? "—"}
            </dd>
          </div>
        )}
      </dl>

      <p className="mt-8 text-sm text-muted-foreground">
        Visit history, consultations, and medicine dispensing land in M4.
      </p>
    </div>
  )
}
