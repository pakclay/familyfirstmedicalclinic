import { requireRole } from "@/lib/auth/guards"
import { listDoctorQueue } from "@/lib/actions/clinical"
import { DoctorQueueView } from "@/components/clinical/doctor-queue-view"

export default async function DoctorQueuePage() {
  await requireRole(["OWNER", "DOCTOR"])
  const queue = await listDoctorQueue()

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Doctor review queue</h1>
        <p className="text-sm text-muted-foreground">
          Rehab-track assessments waiting on a signed prescription. Wellness clients never appear here.
        </p>
      </div>

      <DoctorQueueView
        items={queue.map((a) => ({
          id: a.id,
          patientId: a.patientId,
          patientName: `${a.patient.lastName}, ${a.patient.firstName}`,
          patientCode: a.patient.patientCode,
          assessedAt: a.assessedAt.toISOString(),
          chiefComplaint: a.chiefComplaint,
          painScale: a.painScale,
          painLocation: a.painLocation,
          mechanismOfInjury: a.mechanismOfInjury,
          redFlags: a.redFlags,
          recommendation: a.recommendation,
          draftPrescriptionId: a.prescriptions[0]?.id,
        }))}
      />
    </div>
  )
}
