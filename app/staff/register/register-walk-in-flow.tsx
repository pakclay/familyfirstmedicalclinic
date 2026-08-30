"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardContent } from "@/components/ui/card"
import type { PatientDTO } from "@/lib/dto/patient"
import { searchPatientsAction, registerNewPatientAction, checkInExistingAction } from "./actions"

// `term` is whatever the desk typed — a name or a number. It is carried
// through the flow only to prefill and to label; nothing branches on which
// kind it is except the phone prefill below.
type Step =
  | { name: "start" }
  | { name: "candidates"; term: string; reasonForVisit: string; priority: boolean; candidates: PatientDTO[] }
  | { name: "new-form"; term: string; reasonForVisit: string; priority: boolean }
  | { name: "done"; patientName: string; queueNumber: number }

type NewPatientForm = {
  firstName: string
  lastName: string
  middleName: string
  birthdate: string
  sex: string
  phone: string
  email: string
  address: string
  emergencyContactName: string
  emergencyContactPhone: string
  guardianName: string
  guardianPhone: string
  consent: boolean
}

const EMPTY_NEW_PATIENT_FORM: NewPatientForm = {
  firstName: "",
  lastName: "",
  middleName: "",
  birthdate: "",
  sex: "",
  phone: "",
  email: "",
  address: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  guardianName: "",
  guardianPhone: "",
  consent: false,
}

/**
 * A search term is worth prefilling into the phone field only if it plausibly
 * is one — otherwise the desk searched a name and would have to clear it out.
 */
function asPhoneOrEmpty(term: string): string {
  return term.replace(/\D/g, "").length >= 7 ? term.trim() : ""
}

export function RegisterWalkInFlow() {
  const [step, setStep] = useState<Step>({ name: "start" })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newPatientForm, setNewPatientForm] = useState<NewPatientForm>(EMPTY_NEW_PATIENT_FORM)
  const router = useRouter()

  async function handleStart(formData: FormData) {
    setPending(true)
    setError(null)
    const term = String(formData.get("term") ?? "").trim()
    const reasonForVisit = String(formData.get("reasonForVisit") ?? "").trim()
    const priority = formData.get("priority") === "on"
    if (!term || !reasonForVisit) {
      setError("A name or mobile number and a reason for visit are both required.")
      setPending(false)
      return
    }
    try {
      const candidates = await searchPatientsAction(term)
      if (candidates.length === 0) {
        setNewPatientForm({ ...EMPTY_NEW_PATIENT_FORM, phone: asPhoneOrEmpty(term) })
      }
      setStep(
        candidates.length > 0
          ? { name: "candidates", term, reasonForVisit, priority, candidates }
          : { name: "new-form", term, reasonForVisit, priority }
      )
    } catch {
      setError("Something went wrong searching. Try again.")
    } finally {
      setPending(false)
    }
  }

  async function handleCheckInExisting(patientId: string) {
    if (step.name !== "candidates") return
    setPending(true)
    setError(null)
    try {
      const { patient, queueEntry } = await checkInExistingAction(patientId, step.reasonForVisit, step.priority)
      setStep({
        name: "done",
        patientName: patient ? `${patient.firstName} ${patient.lastName}` : "Patient",
        queueNumber: queueEntry.queueNumber,
      })
    } catch {
      setError("Couldn't check in this patient. Try again.")
    } finally {
      setPending(false)
    }
  }

  async function handleNewPatientSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (step.name !== "new-form") return
    setPending(true)
    setError(null)
    const input = {
      ...newPatientForm,
      reasonForVisit: step.reasonForVisit,
      priority: step.priority,
    }
    const res = await registerNewPatientAction(input)
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setStep({
      name: "done",
      patientName: `${res.result.patient.firstName} ${res.result.patient.lastName}`,
      queueNumber: res.result.queueEntry.queueNumber,
    })
  }

  function reset() {
    setStep({ name: "start" })
    setError(null)
    setNewPatientForm(EMPTY_NEW_PATIENT_FORM)
  }

  if (step.name === "done") {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <p className="text-sm text-muted-foreground">{step.patientName} is checked in</p>
          <p className="font-numeric text-7xl font-bold text-brand">{step.queueNumber}</p>
          <p className="text-sm text-muted-foreground">Queue number</p>
          <div className="mt-4 flex gap-2">
            <Button onClick={reset} className="h-11">
              Register another
            </Button>
            <Button variant="outline" className="h-11" onClick={() => router.push("/staff/queue")}>
              Go to queue
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (step.name === "candidates") {
    return (
      <Card>
        <CardContent className="flex flex-col gap-3 py-6">
          <p className="text-sm text-muted-foreground">
            Found {step.candidates.length} existing patient{step.candidates.length > 1 ? "s" : ""} matching &ldquo;
            {step.term}&rdquo;:
          </p>
          <ul className="divide-y divide-border rounded-md border border-border">
            {step.candidates.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                {/* Phone and age are both shown: with name search, two real
                    people can share a name and the number is what tells them
                    apart at the counter. */}
                <span className="min-w-0 text-sm">
                  {p.lastName}, {p.firstName}
                  <span className="block text-xs text-muted-foreground">
                    {p.age}y · {p.phone}
                  </span>
                </span>
                <Button size="sm" disabled={pending} onClick={() => handleCheckInExisting(p.id)}>
                  This is the patient
                </Button>
              </li>
            ))}
          </ul>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button
            variant="outline"
            className="h-11"
            disabled={pending}
            onClick={() => {
              setNewPatientForm({ ...EMPTY_NEW_PATIENT_FORM, phone: asPhoneOrEmpty(step.term) })
              setStep({ name: "new-form", term: step.term, reasonForVisit: step.reasonForVisit, priority: step.priority })
            }}
          >
            None of these — register a new patient
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (step.name === "new-form") {
    const set = <K extends keyof NewPatientForm>(key: K, value: NewPatientForm[K]) =>
      setNewPatientForm((prev) => ({ ...prev, [key]: value }))

    return (
      <Card>
        <CardContent className="py-6">
          <form onSubmit={handleNewPatientSubmit} className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              New patient · no match for &ldquo;{step.term}&rdquo; · {step.reasonForVisit}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="First name" name="firstName" required autoFocus value={newPatientForm.firstName} onChange={(v) => set("firstName", v)} />
              <Field label="Last name" name="lastName" required value={newPatientForm.lastName} onChange={(v) => set("lastName", v)} />
            </div>
            <Field label="Middle name" name="middleName" value={newPatientForm.middleName} onChange={(v) => set("middleName", v)} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Birthdate" name="birthdate" type="date" required value={newPatientForm.birthdate} onChange={(v) => set("birthdate", v)} />
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sex">Sex</Label>
                <select
                  id="sex"
                  name="sex"
                  required
                  value={newPatientForm.sex}
                  onChange={(e) => set("sex", e.target.value)}
                  className="h-10 rounded-md border border-input bg-transparent px-3 text-sm"
                >
                  <option value="">Select…</option>
                  <option value="FEMALE">Female</option>
                  <option value="MALE">Male</option>
                </select>
              </div>
            </div>
            {/* Its own field now. The search term used to double as the phone
                number, which only worked while the search was phone-only —
                someone found by name would otherwise have no number recorded. */}
            <Field label="Mobile number" name="phone" type="tel" required value={newPatientForm.phone} onChange={(v) => set("phone", v)} />
            <Field label="Address" name="address" required value={newPatientForm.address} onChange={(v) => set("address", v)} />
            <Field label="Email (optional)" name="email" type="email" value={newPatientForm.email} onChange={(v) => set("email", v)} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Emergency contact name" name="emergencyContactName" required value={newPatientForm.emergencyContactName} onChange={(v) => set("emergencyContactName", v)} />
              <Field label="Emergency contact phone" name="emergencyContactPhone" required value={newPatientForm.emergencyContactPhone} onChange={(v) => set("emergencyContactPhone", v)} />
            </div>
            <div className="grid grid-cols-2 gap-3 rounded-md border border-border p-3">
              <div className="col-span-2 text-xs text-muted-foreground">
                Guardian — required only if the patient is under 18
              </div>
              <Field label="Guardian name" name="guardianName" value={newPatientForm.guardianName} onChange={(v) => set("guardianName", v)} />
              <Field label="Guardian phone" name="guardianPhone" value={newPatientForm.guardianPhone} onChange={(v) => set("guardianPhone", v)} />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                required
                className="mt-0.5"
                checked={newPatientForm.consent}
                onCheckedChange={(checked) => set("consent", checked === true)}
              />
              I confirm the patient (or guardian) consents to the clinic collecting and using their health
              information for care and follow-up.
            </label>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button type="submit" disabled={pending} className="h-11 flex-1">
                {pending ? "Registering…" : "Register & check in"}
              </Button>
              <Button type="button" variant="ghost" className="h-11" onClick={reset}>
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className="py-6">
        <form action={handleStart} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="term">Patient name or mobile number</Label>
            <Input
              id="term"
              name="term"
              required
              autoFocus
              autoComplete="off"
              placeholder="e.g. Dela Cruz, or 0917…"
              className="h-11"
            />
            <p className="text-xs text-muted-foreground">
              Search before registering — a returning patient should keep the record they already have.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reasonForVisit">Reason for visit</Label>
            <Input id="reasonForVisit" name="reasonForVisit" required className="h-11" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox name="priority" />
            Priority (senior citizen, PWD, pregnant, infant, or emergency)
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={pending} className="h-11">
            {pending ? "Checking…" : "Continue"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function Field({
  label,
  name,
  type = "text",
  required,
  autoFocus,
  value,
  onChange,
}: {
  label: string
  name: string
  type?: string
  required?: boolean
  autoFocus?: boolean
  value?: string
  onChange?: (value: string) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type={type}
        required={required}
        autoFocus={autoFocus}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        className="h-10"
      />
    </div>
  )
}
