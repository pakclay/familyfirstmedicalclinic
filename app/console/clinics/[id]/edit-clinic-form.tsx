"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { ClinicDTO } from "@/lib/dto/clinic"
import { WEEKDAYS, WEEKDAY_LABEL, type Weekday } from "@/lib/validation/clinic"
import { updateClinicAction } from "../actions"

type DayForm = { open: string; close: string; closed: boolean }

/** A closed day has no stored times — fall back to sensible ones so unchecking "Closed" isn't a blank row. */
function toDayForms(clinic: ClinicDTO): Record<Weekday, DayForm> {
  const forms = {} as Record<Weekday, DayForm>
  for (const day of WEEKDAYS) {
    const stored = clinic.operatingHours[day]
    forms[day] = stored
      ? { open: stored.open, close: stored.close, closed: false }
      : { open: "09:00", close: "18:00", closed: true }
  }
  return forms
}

export function EditClinicForm({ clinic }: { clinic: ClinicDTO }) {
  const [name, setName] = useState(clinic.name)
  const [address, setAddress] = useState(clinic.address)
  const [city, setCity] = useState(clinic.city)
  const [phone, setPhone] = useState(clinic.phone)
  const [facebookPageUrl, setFacebookPageUrl] = useState(clinic.facebookPageUrl ?? "")
  const [timezone, setTimezone] = useState(clinic.timezone)
  const [hours, setHours] = useState<Record<Weekday, DayForm>>(() => toDayForms(clinic))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function setDay(day: Weekday, patch: Partial<DayForm>) {
    setHours((h) => ({ ...h, [day]: { ...h[day], ...patch } }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    setSaved(false)
    const operatingHours = Object.fromEntries(
      WEEKDAYS.map((d) => [d, hours[d].closed ? null : { open: hours[d].open, close: hours[d].close }])
    )
    // No slug in this payload — editClinicSchema doesn't accept one, and
    // the query layer never writes it.
    const res = await updateClinicAction(clinic.id, {
      name,
      address,
      city,
      phone,
      facebookPageUrl,
      timezone,
      operatingHours,
    })
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setSaved(true)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Name</Label>
        <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} className="h-10" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="slug">URL slug</Label>
        <Input id="slug" value={clinic.slug} disabled readOnly className="h-10" />
        <p className="text-xs text-muted-foreground">
          Fixed once the clinic exists — the booking link /book/{clinic.slug} may already be shared publicly.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="address">Address</Label>
        <Input id="address" required value={address} onChange={(e) => setAddress(e.target.value)} className="h-10" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="city">City</Label>
        <Input id="city" required value={city} onChange={(e) => setCity(e.target.value)} className="h-10" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="phone">Phone</Label>
        <Input id="phone" required value={phone} onChange={(e) => setPhone(e.target.value)} className="h-10" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="facebookPageUrl">Facebook page (optional)</Label>
        <Input
          id="facebookPageUrl"
          type="url"
          placeholder="https://facebook.com/…"
          value={facebookPageUrl}
          onChange={(e) => setFacebookPageUrl(e.target.value)}
          className="h-10"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="timezone">Timezone</Label>
        <Input id="timezone" required value={timezone} onChange={(e) => setTimezone(e.target.value)} className="h-10" />
      </div>

      <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3">
        <legend className="px-1 text-sm font-medium">Operating hours</legend>
        {WEEKDAYS.map((day) => (
          <div key={day} className="flex flex-wrap items-center gap-2">
            <span className="w-24 text-sm">{WEEKDAY_LABEL[day]}</span>
            <Input
              aria-label={`${WEEKDAY_LABEL[day]} opening time`}
              type="time"
              className="h-9 w-32"
              disabled={hours[day].closed}
              value={hours[day].closed ? "" : hours[day].open}
              onChange={(e) => setDay(day, { open: e.target.value })}
            />
            <span className="text-sm text-muted-foreground">to</span>
            <Input
              aria-label={`${WEEKDAY_LABEL[day]} closing time`}
              type="time"
              className="h-9 w-32"
              disabled={hours[day].closed}
              value={hours[day].closed ? "" : hours[day].close}
              onChange={(e) => setDay(day, { close: e.target.value })}
            />
            <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={hours[day].closed}
                onChange={(e) => setDay(day, { closed: e.target.checked })}
              />
              Closed
            </label>
          </div>
        ))}
      </fieldset>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && <p className="text-sm text-muted-foreground">Saved.</p>}
      <Button type="submit" disabled={pending} className="h-11 text-base">
        {pending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  )
}
