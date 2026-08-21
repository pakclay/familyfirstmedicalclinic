"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { NewAssessmentDialog } from "./new-assessment-dialog"
import { NewPrescriptionDialog } from "./new-prescription-dialog"
import { NewCarePlanDialog } from "./new-care-plan-dialog"
import { signPrescription } from "@/lib/actions/clinical"

type Assessment = {
  id: string
  track: "WELLNESS" | "REHAB"
  assessedAt: string
  chiefComplaint: string
  needsDoctorReview: boolean
  recommendation: string
}
type Prescription = { id: string; assessmentId: string; diagnosis: string; status: string; prescribedSessions: number }
type CarePlan = { id: string; track: string; status: string; totalSessions: number; completedSessions: number; assignedTherapistName: string }

export function PatientClinicalCard({
  patientId,
  branchId,
  canWriteAssessment,
  canWritePrescription,
  canWriteCarePlan,
  therapists,
  assessments,
  prescriptions,
  carePlans,
}: {
  patientId: string
  branchId: string
  canWriteAssessment: boolean
  canWritePrescription: boolean
  canWriteCarePlan: boolean
  therapists: { id: string; name: string }[]
  assessments: Assessment[]
  prescriptions: Prescription[]
  carePlans: CarePlan[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [newAssessmentOpen, setNewAssessmentOpen] = useState(false)
  const [prescriptionForAssessment, setPrescriptionForAssessment] = useState<string | null>(null)
  const [carePlanFor, setCarePlanFor] = useState<{ track: "WELLNESS" | "REHAB"; prescriptionId?: string; totalSessions: number } | null>(
    null
  )

  const hasActiveCarePlan = carePlans.some((c) => c.status === "ACTIVE")
  const latestAssessment = assessments[0]
  const signedPrescription = prescriptions.find((p) => p.status === "SIGNED")

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Clinical</CardTitle>
        {canWriteAssessment ? (
          <Button size="sm" variant="outline" onClick={() => setNewAssessmentOpen(true)}>
            New assessment
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div>
          <p className="mb-1 font-medium text-muted-foreground">Assessments</p>
          {assessments.length === 0 ? (
            <p className="text-muted-foreground">None yet.</p>
          ) : (
            <div className="space-y-2">
              {assessments.map((a) => {
                const hasPrescription = prescriptions.some((p) => p.assessmentId === a.id)
                return (
                  <div key={a.id} className="rounded-md border border-border p-2">
                    <div className="flex items-center justify-between">
                      <Badge variant={a.track === "REHAB" ? "destructive" : "secondary"}>{a.track}</Badge>
                      <span className="font-numeric text-xs text-muted-foreground">
                        {new Date(a.assessedAt).toLocaleDateString("en-PH")}
                      </span>
                    </div>
                    <p className="mt-1">{a.chiefComplaint}</p>
                    {a.needsDoctorReview && !hasPrescription && canWritePrescription ? (
                      <Button size="sm" variant="outline" className="mt-2" onClick={() => setPrescriptionForAssessment(a.id)}>
                        Write prescription
                      </Button>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {prescriptions.length > 0 ? (
          <>
            <Separator />
            <div>
              <p className="mb-1 font-medium text-muted-foreground">Prescriptions</p>
              <div className="space-y-2">
                {prescriptions.map((p) => (
                  <div key={p.id} className="flex items-center justify-between rounded-md border border-border p-2">
                    <span>{p.diagnosis}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant={p.status === "SIGNED" ? "default" : "outline"}>{p.status}</Badge>
                      {p.status === "DRAFT" && canWritePrescription ? (
                        <Button
                          size="sm"
                          disabled={isPending}
                          onClick={() =>
                            startTransition(async () => {
                              await signPrescription(p.id)
                              router.refresh()
                            })
                          }
                        >
                          Sign
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : null}

        <Separator />
        <div>
          <p className="mb-1 font-medium text-muted-foreground">Care plan</p>
          {carePlans.length === 0 ? (
            <p className="text-muted-foreground">No care plan yet.</p>
          ) : (
            <div className="space-y-2">
              {carePlans.map((c) => (
                <div key={c.id} className="flex items-center justify-between rounded-md border border-border p-2">
                  <span>
                    {c.track} · {c.assignedTherapistName}
                  </span>
                  <Badge variant="secondary" className="font-numeric">
                    {c.completedSessions}/{c.totalSessions} · {c.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}

          {!hasActiveCarePlan && canWriteCarePlan && latestAssessment ? (
            <div className="mt-2">
              {latestAssessment.track === "WELLNESS" ? (
                <Button size="sm" variant="outline" onClick={() => setCarePlanFor({ track: "WELLNESS", totalSessions: 10 })}>
                  Start care plan
                </Button>
              ) : signedPrescription ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setCarePlanFor({
                      track: "REHAB",
                      prescriptionId: signedPrescription.id,
                      totalSessions: signedPrescription.prescribedSessions,
                    })
                  }
                >
                  Start care plan from signed prescription
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">Waiting on a signed prescription before a care plan can start.</p>
              )}
            </div>
          ) : null}
        </div>
      </CardContent>

      {canWriteAssessment ? (
        <NewAssessmentDialog open={newAssessmentOpen} onOpenChange={setNewAssessmentOpen} patientId={patientId} branchId={branchId} />
      ) : null}

      {canWritePrescription && prescriptionForAssessment ? (
        <NewPrescriptionDialog
          open={!!prescriptionForAssessment}
          onOpenChange={(open) => !open && setPrescriptionForAssessment(null)}
          patientId={patientId}
          assessmentId={prescriptionForAssessment}
          onCreated={() => setPrescriptionForAssessment(null)}
        />
      ) : null}

      {canWriteCarePlan && carePlanFor ? (
        <NewCarePlanDialog
          open={!!carePlanFor}
          onOpenChange={(open) => !open && setCarePlanFor(null)}
          patientId={patientId}
          track={carePlanFor.track}
          prescriptionId={carePlanFor.prescriptionId}
          defaultTotalSessions={carePlanFor.totalSessions}
          therapists={therapists}
        />
      ) : null}
    </Card>
  )
}
