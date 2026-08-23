"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { WEEKDAYS, WEEKDAY_LABEL, type Weekday } from "@/lib/validation/clinic"
import { createClinicAction } from "../actions"

type DayForm = { open: string; close: string; closed: boolean }

const DEFAULT_OPEN = "09:00"
const DEFAULT_CLOSE = "18:00"

/** Mon–Sat open, Sunday closed — the shape the existing clinics were seeded with. */
const initialHours: Record<Weekday, DayForm> = {
  mon: { open: DEFAULT_OPEN, close: DEFAULT_CLOSE, closed: false },
  tue: { open: DEFAULT_OPEN, close: DEFAULT_CLOSE, closed: false },
  wed: { open: DEFAULT_OPEN, close: DEFAULT_CLOSE, closed: false },
  thu: { open: DEFAULT_OPEN, close: DEFAULT_CLOSE, closed: false },
  fri: { open: DEFAULT_OPEN, close: DEFAULT_CLOSE, closed: false },
  sat: { open: "08:00", close: "12:00", closed: false },
  sun: { open: DEFAULT_OPEN, close: DEFAULT_CLOSE, closed: true },
}

type Form = {
  name: string
  slug: string
  address: string
  city: string
  phone: string
  facebookPageUrl: string
  timezone: string
}

const initial: Form = {
  name: "",
  slug: "",
  address: "",
  city: "",
  phone: "",
  facebookPageUrl: "",
  // Pre-filled here rather than defaulted in the Zod schema, so the value
  // the admin submits is always the one they can see on screen.
  timezone: "Asia/Manila",
}

export function NewClinicForm() {
  const [form, setForm] = useState<Form>(initial)
  const [hours, setHours] = useState<Record<Weekday, DayForm>>(initialHours)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ name: string; slug: string } | null>(null)

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function setDay(day: Weekday, patch: Partial<DayForm>) {
    setHours((h) => ({ ...h, [day]: { ...h[day], ...patch } }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const operatingHours = Object.fromEntries(
      WEEKDAYS.map((d) => [d, hours[d].closed ? null : { open: hours[d].open, close: hours[d].close }])
    )
    const res = await createClinicAction({ ...form, operatingHours })
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setCreated({ name: res.clinic.name, slug: res.clinic.slug })
  }

  if (created) {
    return (
      <Card>
        <CardContent className="py-6">
          <p className="text-sm">
            <strong>{created.name}</strong> is set up.
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            Its public booking link is <span className="font-mono">/book/{created.slug}</span> and its waiting-room
            display is <span className="font-mono">/display/{created.slug}</span>.
          </p>
          <div className="mt-4 flex gap-2">
            <Button type="button" variant="outline" onClick={() => setCreated(null)}>
              Add another
            </Button>
            <Button type="button" asChild>
              <Link href="/console/clinics">Back to clinics</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" required autoFocus value={form.name} onChange={(e) => set("name", e.target.value)} className="h-10" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="slug">URL slug</Label>
        <Input
          id="slug"
          name="slug"
          required
          placeholder="quezon-city"
          value={form.slug}
          onChange={(e) => set("slug", e.target.value)}
          className="h-10"
        />
        <p className="text-xs text-muted-foreground">
          Used in the public booking link (/book/{form.slug || "…"}) and the waiting-room display. Lowercase letters,
          numbers and hyphens only — it can&rsquo;t be changed later, because links already shared on Facebook would
          stop working.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="address">Address</Label>
        <Input id="address" name="address" required value={form.address} onChange={(e) => set("address", e.target.value)} className="h-10" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="city">City</Label>
        <Input id="city" name="city" required value={form.city} onChange={(e) => set("city", e.target.value)} className="h-10" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="phone">Phone</Label>
        <Input id="phone" name="phone" required value={form.phone} onChange={(e) => set("phone", e.target.value)} className="h-10" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="facebookPageUrl">Facebook page (optional)</Label>
        <Input
          id="facebookPageUrl"
          name="facebookPageUrl"
          type="url"
          placeholder="https://facebook.com/…"
          value={form.facebookPageUrl}
          onChange={(e) => set("facebookPageUrl", e.target.value)}
          className="h-10"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="timezone">Timezone</Label>
        <Input id="timezone" name="timezone" required value={form.timezone} onChange={(e) => set("timezone", e.target.value)} className="h-10" />
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
      <Button type="submit" disabled={pending} className="mt-2 h-11 text-base">
        {pending ? "Creating…" : "Create clinic"}
      </Button>
    </form>
  )
}
