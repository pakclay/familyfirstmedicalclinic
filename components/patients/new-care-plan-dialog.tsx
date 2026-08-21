"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { createCarePlan } from "@/lib/actions/clinical"

export function NewCarePlanDialog({
  open,
  onOpenChange,
  patientId,
  track,
  prescriptionId,
  defaultTotalSessions,
  therapists,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  patientId: string
  track: "WELLNESS" | "REHAB"
  prescriptionId?: string
  defaultTotalSessions: number
  therapists: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [totalSessions, setTotalSessions] = useState(String(defaultTotalSessions))
  const [targetEndDate, setTargetEndDate] = useState("")
  const [assignedTherapistId, setAssignedTherapistId] = useState(therapists[0]?.id ?? "")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit() {
    if (!assignedTherapistId) {
      setError("Assign a therapist.")
      return
    }
    setError(null)
    setPending(true)
    try {
      await createCarePlan({
        patientId,
        track,
        prescriptionId,
        totalSessions: Number(totalSessions),
        targetEndDate: targetEndDate || undefined,
        assignedTherapistId,
      })
      onOpenChange(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start this care plan.")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start care plan</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="space-y-2">
            <Label>Total sessions</Label>
            <Input type="number" min={1} value={totalSessions} onChange={(e) => setTotalSessions(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Target end date (optional)</Label>
            <Input type="date" value={targetEndDate} onChange={(e) => setTargetEndDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Assign therapist</Label>
            <Select value={assignedTherapistId} onValueChange={setAssignedTherapistId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a therapist" />
              </SelectTrigger>
              <SelectContent>
                {therapists.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={pending}>
            {pending ? "Starting…" : "Start care plan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
