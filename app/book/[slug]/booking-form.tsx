"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardContent } from "@/components/ui/card"
import { createBookingAction, type BookingResult } from "./actions"

export function BookingForm({ slug }: { slug: string }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<BookingResult | null>(null)

  async function handleSubmit(formData: FormData) {
    setPending(true)
    setError(null)
    const input = {
      firstName: String(formData.get("firstName") ?? ""),
      lastName: String(formData.get("lastName") ?? ""),
      middleName: String(formData.get("middleName") ?? ""),
      birthdate: String(formData.get("birthdate") ?? ""),
      sex: String(formData.get("sex") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      email: String(formData.get("email") ?? ""),
      address: String(formData.get("address") ?? ""),
      emergencyContactName: String(formData.get("emergencyContactName") ?? ""),
      emergencyContactPhone: String(formData.get("emergencyContactPhone") ?? ""),
      guardianName: String(formData.get("guardianName") ?? ""),
      guardianPhone: String(formData.get("guardianPhone") ?? ""),
      reasonForVisit: String(formData.get("reasonForVisit") ?? ""),
      priority: formData.get("priority") === "on",
      preferredDate: String(formData.get("preferredDate") ?? "today"),
      consent: formData.get("consent") === "on",
    }
    const res = await createBookingAction(slug, input)
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
        <form action={handleSubmit} className="flex flex-col gap-4">
          <div>
            <Label className="mb-1.5 block">When</Label>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-1.5">
                <input type="radio" name="preferredDate" value="today" defaultChecked />
                Today
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" name="preferredDate" value="tomorrow" />
                Tomorrow
              </label>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="First name" name="firstName" required autoFocus />
            <Field label="Last name" name="lastName" required />
          </div>
          <Field label="Middle name" name="middleName" />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Birthdate" name="birthdate" type="date" required />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sex">Sex</Label>
              <select id="sex" name="sex" required className="h-10 rounded-md border border-input bg-transparent px-3 text-sm">
                <option value="">Select…</option>
                <option value="FEMALE">Female</option>
                <option value="MALE">Male</option>
              </select>
            </div>
          </div>
          <Field label="Mobile number" name="phone" type="tel" required />
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
          <Field label="Reason for visit" name="reasonForVisit" required />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox name="priority" />
            I qualify for priority (senior citizen, PWD, pregnant, or infant)
          </label>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox name="consent" required className="mt-0.5" />
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
