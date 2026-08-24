import { redirect, notFound, forbidden } from "next/navigation"
import { auth } from "@/auth"
import { getPatientById, listPatientVisits } from "@/lib/queries/patients"
import { listPatientConsultationHistory } from "@/lib/queries/consultations"
import { ForbiddenError } from "@/lib/permissions/errors"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { Badge } from "@/components/ui/badge"
import { DispensedMedicineList } from "./dispensed-medicine-list"

const STATUS_LABEL: Record<string, string> = {
  BOOKED: "Booked",
  CHECKED_IN: "Checked in",
  WAITING: "Waiting",
  CALLED: "Called",
  IN_CONSULTATION: "In consultation",
  COMPLETED: "Completed",
  NO_SHOW: "No-show",
  CANCELLED: "Cancelled",
}

const SOURCE_LABEL: Record<string, string> = {
  FACEBOOK: "Facebook",
  WALK_IN: "Walk-in",
  PHONE: "Phone",
  ONLINE: "Online",
}

export default async function PatientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  if (!session?.user) redirect("/login")

  const user: AbilitySubject = {
    id: session.user.id,
    role: session.user.role,
    branchId: session.user.branchId,
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

  const [visits, consultations] = await Promise.all([
    listPatientVisits(user, id),
    listPatientConsultationHistory(user, id),
  ])
  const consultationByQueueEntry = new Map(consultations.map((c) => [c.queueEntryId, c]))

  return (
    <div className="mx-auto max-w-2xl">
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

      <h2 className="mt-8 text-lg font-heading font-semibold">Visit history</h2>
      <ul className="mt-3 divide-y divide-border rounded-md border border-border">
        {visits.map((v) => {
          const consultation = consultationByQueueEntry.get(v.id)
          return (
            <li key={v.id} className="px-4 py-3 text-sm">
              <div className="flex items-center justify-between">
                <span>
                  {v.queueDate.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" })}
                  {" · "}
                  {SOURCE_LABEL[v.source]}
                  {v.priority === "PRIORITY" && (
                    <Badge variant="outline" className="ml-2 border-priority text-priority">
                      Priority
                    </Badge>
                  )}
                </span>
                <span className="font-numeric text-muted-foreground">
                  #{v.queueNumber} · {STATUS_LABEL[v.status]}
                </span>
              </div>
              {consultation && (
                <div className="mt-1.5 border-l-2 border-border pl-2.5 text-xs text-muted-foreground">
                  <p>
                    {consultation.doctorName}
                    {consultation.diagnosis && <> · {consultation.diagnosis}</>}
                  </p>
                  {consultation.medicines.length > 0 && (
                    <DispensedMedicineList
                      patientId={id}
                      medicines={consultation.medicines}
                      canDelete={session.user.role === "CLINIC_ADMIN"}
                    />
                  )}
                </div>
              )}
            </li>
          )
        })}
        {visits.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">No visits yet.</li>
        )}
      </ul>
    </div>
  )
}
