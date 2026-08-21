"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { createAssessment } from "@/lib/actions/clinical"

const EMPTY = {
  track: "WELLNESS" as "WELLNESS" | "REHAB",
  chiefComplaint: "",
  painScale: "0",
  painLocation: "",
  onsetDate: "",
  mechanismOfInjury: "",
  romFindings: "",
  specialTests: "",
  redFlags: "",
  recommendation: "",
}

export function NewAssessmentDialog({
  open,
  onOpenChange,
  patientId,
  branchId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  patientId: string
  branchId: string
}) {
  const router = useRouter()
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const isRehab = form.track === "REHAB"

  async function handleSubmit() {
    setError(null)
    setPending(true)
    try {
      await createAssessment({
        ...form,
        painScale: Number(form.painScale),
        patientId,
        branchId,
      })
      onOpenChange(false)
      setForm(EMPTY)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this assessment.")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New assessment</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-2">
            <Label>Track — is this an injury case?</Label>
            <Select value={form.track} onValueChange={(v) => setForm({ ...form, track: v as "WELLNESS" | "REHAB" })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="WELLNESS">Wellness — recovery, tune-up, no injury</SelectItem>
                <SelectItem value="REHAB">Rehab — injury or condition, needs doctor review</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Chief complaint</Label>
            <Textarea value={form.chiefComplaint} onChange={(e) => setForm({ ...form, chiefComplaint: e.target.value })} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Pain scale (0–10)</Label>
              <Input
                type="number"
                min={0}
                max={10}
                value={form.painScale}
                onChange={(e) => setForm({ ...form, painScale: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Pain location</Label>
              <Input value={form.painLocation} onChange={(e) => setForm({ ...form, painLocation: e.target.value })} />
            </div>
          </div>

          {isRehab ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Onset date</Label>
                  <Input type="date" value={form.onsetDate} onChange={(e) => setForm({ ...form, onsetDate: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Mechanism of injury</Label>
                  <Input value={form.mechanismOfInjury} onChange={(e) => setForm({ ...form, mechanismOfInjury: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>ROM findings</Label>
                <Textarea value={form.romFindings} onChange={(e) => setForm({ ...form, romFindings: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Special tests</Label>
                <Textarea value={form.specialTests} onChange={(e) => setForm({ ...form, specialTests: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Red flags (comma-separated)</Label>
                <Input value={form.redFlags} onChange={(e) => setForm({ ...form, redFlags: e.target.value })} />
              </div>
            </>
          ) : null}

          <div className="space-y-2">
            <Label>Recommendation</Label>
            <Textarea value={form.recommendation} onChange={(e) => setForm({ ...form, recommendation: e.target.value })} />
          </div>

          {isRehab ? (
            <p className="text-xs text-muted-foreground">
              Rehab-track assessments always go to the doctor review queue — wellness never does.
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={pending}>
            {pending ? "Saving…" : "Save assessment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
