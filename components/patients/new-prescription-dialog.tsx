"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { createPrescription } from "@/lib/actions/clinical"

const EMPTY = {
  diagnosis: "",
  icd10: "",
  prescribedSessions: "12",
  frequencyPerWeek: "2",
  modalities: "",
  precautions: "",
  goals: "",
  validFrom: new Date().toISOString().slice(0, 10),
  validUntil: "",
}

export function NewPrescriptionDialog({
  open,
  onOpenChange,
  patientId,
  assessmentId,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  patientId: string
  assessmentId: string
  onCreated: () => void
}) {
  const router = useRouter()
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit() {
    if (!form.validUntil) {
      setError("Set a valid-until date.")
      return
    }
    setError(null)
    setPending(true)
    try {
      await createPrescription({
        ...form,
        prescribedSessions: Number(form.prescribedSessions),
        frequencyPerWeek: Number(form.frequencyPerWeek),
        patientId,
        assessmentId,
      })
      onOpenChange(false)
      setForm(EMPTY)
      onCreated()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this prescription.")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Write prescription</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-2">
            <Label>Diagnosis</Label>
            <Textarea value={form.diagnosis} onChange={(e) => setForm({ ...form, diagnosis: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>ICD-10 (optional)</Label>
            <Input value={form.icd10} onChange={(e) => setForm({ ...form, icd10: e.target.value })} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Prescribed sessions</Label>
              <Input
                type="number"
                min={1}
                value={form.prescribedSessions}
                onChange={(e) => setForm({ ...form, prescribedSessions: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Frequency per week</Label>
              <Input
                type="number"
                min={1}
                max={14}
                value={form.frequencyPerWeek}
                onChange={(e) => setForm({ ...form, frequencyPerWeek: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Modalities (comma-separated)</Label>
            <Input value={form.modalities} onChange={(e) => setForm({ ...form, modalities: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Precautions</Label>
            <Textarea value={form.precautions} onChange={(e) => setForm({ ...form, precautions: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Goals</Label>
            <Textarea value={form.goals} onChange={(e) => setForm({ ...form, goals: e.target.value })} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Valid from</Label>
              <Input type="date" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Valid until</Label>
              <Input type="date" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={pending}>
            {pending ? "Saving…" : "Save as draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
