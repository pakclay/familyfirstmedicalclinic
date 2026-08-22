"use client"

import { useState, type FormEvent } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardContent } from "@/components/ui/card"
import { createBookingAction, type BookingResult } from "./actions"

type BookingFormValues = {
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
  reasonForVisit: string
  priority: boolean
  preferredDate: string
  consent: boolean
}

const EMPTY_BOOKING_FORM: BookingFormValues = {
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
  reasonForVisit: "",
  priority: false,
  preferredDate: "today",
  consent: false,
}

export function BookingForm({ slug }: { slug: string }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<BookingResult | null>(null)
  const [values, setValues] = useState<BookingFormValues>(EMPTY_BOOKING_FORM)

  const set = <K extends keyof BookingFormValues>(key: K, value: BookingFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }))

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const res = await createBookingAction(slug, values)
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setResult(res.result)
  }

  if (result) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            {result.patient.firstName}, you&apos;re booked at {result.clinicName}
          </p>
          <p className="font-numeric text-7xl font-bold text-brand">{result.queueEntry.queueNumber}</p>
          <p className="text-sm text-muted-foreground">Your queue number</p>
          <Button asChild className="mt-4 h-11">
            <Link href={`/q/${result.accessToken}`}>Check your status</Link>
          </Button>
          <p className="text-xs text-muted-foreground">
            Save this link — it&apos;s how you&apos;ll check your place in line.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className="py-6">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <Label className="mb-1.5 block">When</Label>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="preferredDate"
                  value="today"
                  checked={values.preferredDate === "today"}
                  onChange={() => set("preferredDate", "today")}
                />
                Today
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="preferredDate"
                  value="tomorrow"
                  checked={values.preferredDate === "tomorrow"}
                  onChange={() => set("preferredDate", "tomorrow")}
                />
                Tomorrow
              </label>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="First name" name="firstName" required autoFocus value={values.firstName} onChange={(v) => set("firstName", v)} />
            <Field label="Last name" name="lastName" required value={values.lastName} onChange={(v) => set("lastName", v)} />
          </div>
          <Field label="Middle name" name="middleName" value={values.middleName} onChange={(v) => set("middleName", v)} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Birthdate" name="birthdate" type="date" required value={values.birthdate} onChange={(v) => set("birthdate", v)} />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sex">Sex</Label>
              <select
                id="sex"
                name="sex"
                required
                value={values.sex}
                onChange={(e) => set("sex", e.target.value)}
                className="h-10 rounded-md border border-input bg-transparent px-3 text-sm"
              >
                <option value="">Select…</option>
                <option value="FEMALE">Female</option>
                <option value="MALE">Male</option>
              </select>
            </div>
          </div>
          <Field label="Mobile number" name="phone" type="tel" required value={values.phone} onChange={(v) => set("phone", v)} />
          <Field label="Address" name="address" required value={values.address} onChange={(v) => set("address", v)} />
          <Field label="Email (optional)" name="email" type="email" value={values.email} onChange={(v) => set("email", v)} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Emergency contact name" name="emergencyContactName" required value={values.emergencyContactName} onChange={(v) => set("emergencyContactName", v)} />
            <Field label="Emergency contact phone" name="emergencyContactPhone" required value={values.emergencyContactPhone} onChange={(v) => set("emergencyContactPhone", v)} />
          </div>
          <div className="grid grid-cols-2 gap-3 rounded-md border border-border p-3">
            <div className="col-span-2 text-xs text-muted-foreground">
              Guardian — required only if the patient is under 18
            </div>
            <Field label="Guardian name" name="guardianName" value={values.guardianName} onChange={(v) => set("guardianName", v)} />
            <Field label="Guardian phone" name="guardianPhone" value={values.guardianPhone} onChange={(v) => set("guardianPhone", v)} />
          </div>
          <Field label="Reason for visit" name="reasonForVisit" required value={values.reasonForVisit} onChange={(v) => set("reasonForVisit", v)} />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={values.priority} onCheckedChange={(c) => set("priority", c === true)} />
            I qualify for priority (senior citizen, PWD, pregnant, or infant)
          </label>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox required className="mt-0.5" checked={values.consent} onCheckedChange={(c) => set("consent", c === true)} />
            I consent to the clinic collecting and using my (or my dependent&apos;s) health information for care
            and follow-up.
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={pending} className="h-11">
            {pending ? "Booking…" : "Book my visit"}
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
  value: string
  onChange: (value: string) => void
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
        onChange={(e) => onChange(e.target.value)}
        className="h-10"
      />
    </div>
  )
}
