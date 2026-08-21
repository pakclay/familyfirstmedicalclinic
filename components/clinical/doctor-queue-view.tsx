"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { NewPrescriptionDialog } from "@/components/patients/new-prescription-dialog"
import { signPrescription } from "@/lib/actions/clinical"

type QueueItem = {
  id: string
  patientId: string
  patientName: string
  patientCode: string
  assessedAt: string
  chiefComplaint: string
  painScale: number
  painLocation: string | null
  mechanismOfInjury: string | null
  redFlags: string[]
  recommendation: string
  draftPrescriptionId?: string
}

export function DoctorQueueView({ items }: { items: QueueItem[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [prescriptionFor, setPrescriptionFor] = useState<QueueItem | null>(null)

  if (items.length === 0) {
    return (
      <Card className="max-w-xl">
        <CardContent className="py-8 text-center text-sm text-muted-foreground">Queue is clear. Nice.</CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {items.map((item) => (
        <Card key={item.id} className="border-l-4 border-l-rehab">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">
              <Link href={`/console/patients/${item.patientId}`} className="hover:underline">
                {item.patientName}
              </Link>{" "}
              <span className="font-numeric text-sm text-muted-foreground">{item.patientCode}</span>
            </CardTitle>
            <span className="font-numeric text-xs text-muted-foreground">
              Assessed {new Date(item.assessedAt).toLocaleDateString("en-PH")}
            </span>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <span className="text-muted-foreground">Chief complaint: </span>
              {item.chiefComplaint}
            </p>
            <p>
              <span className="text-muted-foreground">Pain: </span>
              <span className="font-numeric">{item.painScale}/10</span>
              {item.painLocation ? ` — ${item.painLocation}` : ""}
            </p>
            {item.mechanismOfInjury ? (
              <p>
                <span className="text-muted-foreground">Mechanism: </span>
                {item.mechanismOfInjury}
              </p>
            ) : null}
            {item.redFlags.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {item.redFlags.map((f) => (
                  <Badge key={f} variant="destructive">
                    {f}
                  </Badge>
                ))}
              </div>
            ) : null}
            <p>
              <span className="text-muted-foreground">PT recommendation: </span>
              {item.recommendation}
            </p>

            <div className="pt-2">
              {item.draftPrescriptionId ? (
                <Button
                  size="sm"
                  disabled={isPending}
                  onClick={() =>
                    startTransition(async () => {
                      await signPrescription(item.draftPrescriptionId!)
                      router.refresh()
                    })
                  }
                >
                  Sign draft prescription
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setPrescriptionFor(item)}>
                  Write prescription
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}

      {prescriptionFor ? (
        <NewPrescriptionDialog
          open={!!prescriptionFor}
          onOpenChange={(open) => !open && setPrescriptionFor(null)}
          patientId={prescriptionFor.patientId}
          assessmentId={prescriptionFor.id}
          onCreated={() => setPrescriptionFor(null)}
        />
      ) : null}
    </div>
  )
}
