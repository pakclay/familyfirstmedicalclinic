import { notFound } from "next/navigation"
import { requireRole } from "@/lib/auth/guards"
import { getPatient } from "@/lib/actions/patients"
import { listActivePackages } from "@/lib/actions/packages"
import { listAssessments, listPrescriptions, listCarePlans } from "@/lib/actions/clinical"
import { canAccess } from "@/lib/permissions/ability"
import { prisma } from "@/lib/db/prisma"
import { ageInYears } from "@/lib/utils/age"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { PatientPackagesCard } from "@/components/patients/patient-packages-card"
import { PatientClinicalCard } from "@/components/patients/patient-clinical-card"

const CAN_SELL_PACKAGES = ["OWNER", "BRANCH_MANAGER", "FRONT_DESK"]

const CONSENT_LABELS: Record<string, string> = {
  TREATMENT: "Treatment",
  DATA_PRIVACY: "Data privacy",
  MARKETING: "Marketing",
  PHOTO: "Photo/video",
}

type TimelineEvent = { at: Date; label: string; detail?: string }

export default async function PatientProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(["OWNER", "BRANCH_MANAGER", "DOCTOR", "THERAPIST", "FRONT_DESK"])
  const { id } = await params
  const patient = await getPatient(id)
  if (!patient) notFound()

  const canSellPackages = CAN_SELL_PACKAGES.includes(user.role)
  const canWriteAssessment = canAccess(user, "soapNotes", "write")
  const canWritePrescription = canAccess(user, "prescription", "write")
  const canWriteCarePlan = canAccess(user, "carePlan", "write")

  const [activePackages, catalog, assessments, prescriptions, carePlans, branchTherapists] = await Promise.all([
    listActivePackages(id).catch(() => []),
    canSellPackages ? prisma.package.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    listAssessments(id).catch(() => []),
    listPrescriptions(id).catch(() => []),
    listCarePlans(id).catch(() => []),
    canWriteCarePlan
      ? prisma.user.findMany({
          where: { role: "THERAPIST", homeBranchId: patient.homeBranchId, isActive: true, deletedAt: null },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ])

  const age = ageInYears(patient.birthDate)

  const timeline: TimelineEvent[] = [
    { at: patient.createdAt, label: "Patient record created" },
    ...patient.intakeSubmissions.map((s) => ({
      at: s.submittedAt,
      label: "Intake form submitted",
      detail: `via ${s.submittedVia.toLowerCase().replace("_", " ")}`,
    })),
    ...patient.consents.map((c) => ({
      at: c.grantedAt,
      label: `${CONSENT_LABELS[c.consentType] ?? c.consentType} consent ${c.granted ? "granted" : "declined"}`,
    })),
    ...assessments.map((a) => ({
      at: a.assessedAt,
      label: `${a.track === "REHAB" ? "Rehab" : "Wellness"} assessment recorded`,
      detail: a.chiefComplaint,
    })),
    ...prescriptions
      .filter((p) => p.signedAt)
      .map((p) => ({ at: p.signedAt!, label: "Prescription signed", detail: p.diagnosis })),
    ...carePlans.map((c) => ({ at: c.startedAt, label: `Care plan started (${c.track.toLowerCase()})` })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime())

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">
              {patient.lastName}, {patient.firstName} {patient.middleName ?? ""}
            </h1>
            <Badge variant="secondary">{patient.status.replaceAll("_", " ")}</Badge>
          </div>
          <p className="font-numeric text-sm text-muted-foreground">{patient.patientCode}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            {timeline.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity yet.</p>
            ) : (
              <ol className="space-y-4">
                {timeline.map((event, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className="font-numeric w-36 shrink-0 text-muted-foreground">
                      {event.at.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                    <span>
                      {event.label}
                      {event.detail ? <span className="text-muted-foreground"> — {event.detail}</span> : null}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        <PatientClinicalCard
          patientId={patient.id}
          branchId={patient.homeBranchId}
          canWriteAssessment={canWriteAssessment}
          canWritePrescription={canWritePrescription}
          canWriteCarePlan={canWriteCarePlan}
          therapists={branchTherapists}
          assessments={assessments.map((a) => ({
            id: a.id,
            track: a.track,
            assessedAt: a.assessedAt.toISOString(),
            chiefComplaint: a.chiefComplaint,
            needsDoctorReview: a.needsDoctorReview,
            recommendation: a.recommendation,
          }))}
          prescriptions={prescriptions.map((p) => ({
            id: p.id,
            assessmentId: p.assessmentId,
            diagnosis: p.diagnosis,
            status: p.status,
            prescribedSessions: p.prescribedSessions,
          }))}
          carePlans={carePlans.map((c) => ({
            id: c.id,
            track: c.track,
            status: c.status,
            totalSessions: c.totalSessions,
            completedSessions: c.completedSessions,
            assignedTherapistName: c.assignedTherapistName,
          }))}
        />
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Demographics</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Field label="Sex" value={patient.sex === "MALE" ? "Male" : "Female"} />
            <Field label="Age" value={`${age}`} />
            <Field label="Mobile" value={patient.mobile} numeric />
            <Field label="Email" value={patient.email ?? "—"} />
            <Field label="Address" value={`${patient.address}, ${patient.city}, ${patient.province}`} />
            <Field label="Occupation" value={patient.occupation ?? "—"} />
            <Field label="Sport/activity" value={patient.sportOrActivity ?? "—"} />
            <Separator />
            <Field label="Branch" value={patient.homeBranch.name} />
            <Field label="Emergency contact" value={patient.emergencyContactName} />
            <Field label="Emergency phone" value={patient.emergencyContactPhone} numeric />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Consents</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {patient.consents.length === 0 ? (
              <p className="text-muted-foreground">No consent on file yet.</p>
            ) : (
              patient.consents.map((c) => (
                <div key={c.id} className="flex items-center justify-between">
                  <span>{CONSENT_LABELS[c.consentType] ?? c.consentType}</span>
                  <Badge variant={c.granted ? "default" : "outline"}>{c.granted ? "Granted" : "Declined"}</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <PatientPackagesCard
          patientId={patient.id}
          branchId={patient.homeBranchId}
          canSell={canSellPackages}
          activePackages={activePackages.map((p) => ({
            id: p.id,
            sessionsUsed: p.sessionsUsed,
            sessionsTotal: p.sessionsTotal,
            expiresAt: p.expiresAt.toISOString(),
            package: { name: p.package.name },
          }))}
          catalog={catalog.map((c) => ({ id: c.id, name: c.name }))}
        />
      </div>
    </div>
  )
}

function Field({ label, value, numeric }: { label: string; value: string; numeric?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className={numeric ? "font-numeric text-right" : "text-right"}>{value}</span>
    </div>
  )
}
