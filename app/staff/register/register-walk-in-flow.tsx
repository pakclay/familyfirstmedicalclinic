"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardContent } from "@/components/ui/card"
import type { PatientDTO } from "@/lib/dto/patient"
import { searchByPhoneAction, registerNewPatientAction, checkInExistingAction } from "./actions"

type Step =
  | { name: "start" }
  | { name: "candidates"; phone: string; reasonForVisit: string; priority: boolean; candidates: PatientDTO[] }
  | { name: "new-form"; phone: string; reasonForVisit: string; priority: boolean }
  | { name: "done"; patientName: string; queueNumber: number }

export function RegisterWalkInFlow() {
  const [step, setStep] = useState<Step>({ name: "start" })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function handleStart(formData: FormData) {
    setPending(true)
    setError(null)
    const phone = String(formData.get("phone") ?? "").trim()
    const reasonForVisit = String(formData.get("reasonForVisit") ?? "").trim()
    const priority = formData.get("priority") === "on"
    if (!phone || !reasonForVisit) {
      setError("Phone number and reason for visit are both required.")
      setPending(false)
      return
    }
    try {
      const candidates = await searchByPhoneAction(phone)
      setStep(
        candidates.length > 0
          ? { name: "candidates", phone, reasonForVisit, priority, candidates }
          : { name: "new-form", phone, reasonForVisit, priority }
      )
    } catch {
      setError("Something went wrong searching for this number. Try again.")
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

  async function handleNewPatientSubmit(formData: FormData) {
    if (step.name !== "new-form") return
    setPending(true)
    setError(null)
    const input = {
      firstName: String(formData.get("firstName") ?? ""),
      lastName: String(formData.get("lastName") ?? ""),
      middleName: String(formData.get("middleName") ?? ""),
      birthdate: String(formData.get("birthdate") ?? ""),
      sex: String(formData.get("sex") ?? ""),
      phone: step.phone,
      email: String(formData.get("email") ?? ""),
      address: String(formData.get("address") ?? ""),
      emergencyContactName: String(formData.get("emergencyContactName") ?? ""),
      emergencyContactPhone: String(formData.get("emergencyContactPhone") ?? ""),
      guardianName: String(formData.get("guardianName") ?? ""),
      guardianPhone: String(formData.get("guardianPhone") ?? ""),
      reasonForVisit: step.reasonForVisit,
      priority: step.priority,
      consent: formData.get("consent") === "on",
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
            Found {step.candidates.length} existing patient{step.candidates.length > 1 ? "s" : ""} with this number:
          </p>
          <ul className="divide-y divide-border rounded-md border border-border">
            {step.candidates.map((p) => (
              <li key={p.id} className="flex items-center justify-between px-4 py-3">
                <span className="text-sm">
                  {p.lastName}, {p.firstName} · {p.age}y
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
            onClick={() => setStep({ name: "new-form", phone: step.phone, reasonForVisit: step.reasonForVisit, priority: step.priority })}
          >
            None of these — register a new patient
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (step.name === "new-form") {
    return (
      <Card>
        <CardContent className="py-6">
          <form action={handleNewPatientSubmit} className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              New patient · {step.phone} · {step.reasonForVisit}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="First name" name="firstName" required autoFocus />
              <Field label="Last name" name="lastName" required />
            </div>
            <Field label="Middle name" name="middleName" />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Birthdate" name="birthdate" type="date" required />
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sex">Sex</Label>
                <select
                  id="sex"
                  name="sex"
                  required
                  className="h-10 rounded-md border border-input bg-transparent px-3 text-sm"
                >
                  <option value="">Select…</option>
                  <option value="FEMALE">Female</option>
                  <option value="MALE">Male</option>
                </select>
              </div>
            </div>
            <Field label="Address" name="address" required />
            <Field label="Email (optional)" name="email" type="email" />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Emergency contact name" name="emergencyContactName" required />
              <Field label="Emergency contact phone" name="emergencyContactPhone" required />
            </div>
            <div className="grid grid-cols-2 gap-3 rounded-md border border-border p-3">
              <div className="col-span-2 text-xs text-muted-foreground">
                Guardian — required only if the patient is under 18
              </div>
              <Field label="Guardian name" name="guardianName" />
              <Field label="Guardian phone" name="guardianPhone" />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox name="consent" required className="mt-0.5" />
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
            <Label htmlFor="phone">Mobile number</Label>
            <Input id="phone" name="phone" type="tel" inputMode="tel" required autoFocus className="h-11" />
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
}: {
  label: string
  name: string
  type?: string
  required?: boolean
  autoFocus?: boolean
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type} required={required} autoFocus={autoFocus} className="h-10" />
    </div>
  )
}
