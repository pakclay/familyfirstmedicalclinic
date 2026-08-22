"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import type { ConsultationScreenData } from "@/lib/queries/consultations"
import { MedicineRow, type MedicineRowState } from "./medicine-row"
import { saveConsultationAction } from "./actions"
import { Checkbox } from "@/components/ui/checkbox"

function newRow(): MedicineRowState {
  return {
    key: crypto.randomUUID(),
    medicineId: null,
    medicineName: "",
    dosage: "",
    quantity: "",
    instructions: "",
    dispensedFromStock: false,
  }
}

export function ConsultationForm({ data }: { data: ConsultationScreenData }) {
  const router = useRouter()
  const [chiefComplaint, setChiefComplaint] = useState("")
  const [vitals, setVitals] = useState({ bp: "", temp: "", weight: "", height: "", pulse: "" })
  const [findings, setFindings] = useState("")
  const [diagnosis, setDiagnosis] = useState("")
  const [treatmentPlan, setTreatmentPlan] = useState("")
  const [followUpDate, setFollowUpDate] = useState("")
  const [rows, setRows] = useState<MedicineRowState[]>([])
  const [amountTouched, setAmountTouched] = useState(false)
  const [amountPesos, setAmountPesos] = useState((data.consultationFee / 100).toFixed(2))
  const [method, setMethod] = useState("CASH")
  const [orNumber, setOrNumber] = useState("")
  const [paymentNotes, setPaymentNotes] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [offerOverride, setOfferOverride] = useState(false)
  const [override, setOverride] = useState(false)

  // §13's decision: itemized separately — consultation fee + Σ(dispensed
  // sellingPrice × quantity). Auto-computed as a *default*, not locked —
  // the doctor can still override for discounts, partial payment, etc.
  const suggestedTotalCentavos = useMemo(() => {
    const medicinesTotal = rows.reduce((sum, r) => {
      if (!r.dispensedFromStock || !r.medicineId) return sum
      const medicine = data.medicines.find((m) => m.id === r.medicineId)
      const qty = Number(r.quantity) || 0
      return sum + (medicine?.sellingPrice ?? 0) * qty
    }, 0)
    return data.consultationFee + medicinesTotal
  }, [rows, data.medicines, data.consultationFee])

  const displayedAmount = amountTouched ? amountPesos : (suggestedTotalCentavos / 100).toFixed(2)

  function updateRow(key: string, patch: Partial<MedicineRowState>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)

    const input = {
      chiefComplaint,
      vitals,
      findings,
      diagnosis,
      treatmentPlan,
      followUpDate,
      medicines: rows
        .filter((r) => r.medicineName.trim())
        .map((r) => ({
          medicineId: r.medicineId,
          medicineName: r.medicineName,
          dosage: r.dosage,
          quantity: r.quantity,
          instructions: r.instructions,
          dispensedFromStock: r.dispensedFromStock,
        })),
      overrideInsufficientStock: override,
      payment: {
        amount: Math.round(Number(displayedAmount) * 100),
        method,
        orNumber,
        notes: paymentNotes,
      },
    }

    const res = await saveConsultationAction(data.queueEntryId, input)
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      setOfferOverride(!!res.insufficientStock)
      return
    }
    router.push("/doctor/queue")
  }

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-heading font-semibold">
          {data.patient.lastName}, {data.patient.firstName}
          {data.priority === "PRIORITY" && (
            <Badge variant="outline" className="ml-2 border-priority text-priority">
              Priority
            </Badge>
          )}
        </h1>
        <p className="text-sm text-muted-foreground">
          #{data.queueNumber} · {data.patient.age}y · {data.patient.sex === "MALE" ? "Male" : "Female"}
          {data.reasonForVisit && ` · ${data.reasonForVisit}`}
        </p>
        {data.patient.notes && <p className="mt-1 text-sm text-priority">Notes: {data.patient.notes}</p>}
      </div>

      {data.history.length > 0 && (
        <details className="mb-4 rounded-md border border-border">
          <summary className="cursor-pointer px-4 py-2 text-sm font-medium">
            Visit history ({data.history.length})
          </summary>
          <ul className="divide-y divide-border">
            {data.history.map((h) => (
              <li key={h.id} className="px-4 py-2 text-sm">
                <p className="text-muted-foreground">
                  {h.date.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" })} · {h.doctorName}
                </p>
                <p>{h.diagnosis || h.chiefComplaint}</p>
                {h.medicines.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {h.medicines.map((m) => `${m.medicineName}${m.dosage ? ` (${m.dosage})` : ""}`).join(", ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Card>
          <CardContent className="flex flex-col gap-3 py-4">
            <Field label="Chief complaint" required>
              <Input value={chiefComplaint} onChange={(e) => setChiefComplaint(e.target.value)} required className="h-10" />
            </Field>
            <div>
              <Label className="mb-1.5 block text-xs text-muted-foreground">Vitals</Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <Input placeholder="BP" value={vitals.bp} onChange={(e) => setVitals((v) => ({ ...v, bp: e.target.value }))} className="h-9" />
                <Input placeholder="Temp" value={vitals.temp} onChange={(e) => setVitals((v) => ({ ...v, temp: e.target.value }))} className="h-9" />
                <Input placeholder="Weight" value={vitals.weight} onChange={(e) => setVitals((v) => ({ ...v, weight: e.target.value }))} className="h-9" />
                <Input placeholder="Height" value={vitals.height} onChange={(e) => setVitals((v) => ({ ...v, height: e.target.value }))} className="h-9" />
                <Input placeholder="Pulse" value={vitals.pulse} onChange={(e) => setVitals((v) => ({ ...v, pulse: e.target.value }))} className="h-9" />
              </div>
            </div>
            <Field label="Findings">
              <Textarea value={findings} onChange={(e) => setFindings(e.target.value)} />
            </Field>
            <Field label="Diagnosis">
              <Textarea value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} />
            </Field>
            <Field label="Treatment plan">
              <Textarea value={treatmentPlan} onChange={(e) => setTreatmentPlan(e.target.value)} />
            </Field>
            <Field label="Follow-up date (optional)">
              <Input type="date" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} className="h-10" />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-3 py-4">
            <div className="flex items-center justify-between">
              <Label>Medicines</Label>
              <Button type="button" size="sm" variant="outline" onClick={() => setRows((r) => [...r, newRow()])}>
                Add medicine
              </Button>
            </div>
            {rows.map((row) => (
              <MedicineRow
                key={row.key}
                row={row}
                medicines={data.medicines}
                onChange={(patch) => updateRow(row.key, patch)}
                onRemove={() => setRows((r) => r.filter((x) => x.key !== row.key))}
              />
            ))}
            {rows.length === 0 && <p className="text-sm text-muted-foreground">No medicines added.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-3 py-4">
            <Label>Payment</Label>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount (₱)">
                <Input
                  type="number"
                  step="0.01"
                  value={displayedAmount}
                  onChange={(e) => {
                    setAmountTouched(true)
                    setAmountPesos(e.target.value)
                  }}
                  className="h-10"
                />
              </Field>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="method">Method</Label>
                <select
                  id="method"
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  className="h-10 rounded-md border border-input bg-transparent px-3 text-sm"
                >
                  <option value="CASH">Cash</option>
                  <option value="GCASH">GCash</option>
                  <option value="CARD">Card</option>
                  <option value="HMO">HMO</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
            </div>
            <Field label="OR number (optional)">
              <Input value={orNumber} onChange={(e) => setOrNumber(e.target.value)} className="h-10" />
            </Field>
            <Field label="Notes (optional)">
              <Input value={paymentNotes} onChange={(e) => setPaymentNotes(e.target.value)} className="h-10" />
            </Field>
            <p className="text-xs text-muted-foreground">Collected by you.</p>
          </CardContent>
        </Card>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <p className="text-sm text-destructive">{error}</p>
            {offerOverride && (
              <label className="mt-2 flex items-start gap-2 text-sm">
                <Checkbox checked={override} onCheckedChange={(c) => setOverride(c === true)} className="mt-0.5" />
                Dispense anyway (stock count is wrong) — this updates stock to reflect what was actually given and
                logs that you overrode the check.
              </label>
            )}
          </div>
        )}
        <Button type="submit" disabled={pending} className="h-12 text-base">
          {pending ? "Saving…" : override ? "Complete consultation anyway" : "Complete consultation"}
        </Button>
      </form>
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
    </div>
  )
}
