"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { BranchDTO } from "@/lib/dto/branch"
import type { Weekday } from "@/lib/validation/operating-hours"
import { OperatingHoursFields, toDayForms, toOperatingHours, type DayForm } from "../../../operating-hours-fields"
import { updateBranchAction } from "../../../actions"

export function EditBranchForm({ clinicId, branch }: { clinicId: string; branch: BranchDTO }) {
  const [name, setName] = useState(branch.name)
  const [address, setAddress] = useState(branch.address)
  const [city, setCity] = useState(branch.city)
  const [phone, setPhone] = useState(branch.phone)
  const [facebookPageUrl, setFacebookPageUrl] = useState(branch.facebookPageUrl ?? "")
  const [timezone, setTimezone] = useState(branch.timezone)
  const [hours, setHours] = useState<Record<Weekday, DayForm>>(() => toDayForms(branch.operatingHours))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    setSaved(false)
    // No slug in this payload — editBranchSchema doesn't accept one, and
    // the query layer never writes it.
    const res = await updateBranchAction(clinicId, branch.id, {
      name,
      address,
      city,
      phone,
      facebookPageUrl,
      timezone,
      operatingHours: toOperatingHours(hours),
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
        <Input id="slug" value={branch.slug} disabled readOnly className="h-10" />
        <p className="text-xs text-muted-foreground">
          Fixed once the branch exists — the booking link /book/{branch.slug} may already be shared publicly.
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

      <OperatingHoursFields value={hours} onChange={setHours} />

      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && <p className="text-sm text-muted-foreground">Saved.</p>}
      <Button type="submit" disabled={pending} className="h-11 text-base">
        {pending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  )
}
