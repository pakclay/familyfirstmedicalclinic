"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { ClinicDTO } from "@/lib/dto/clinic"
import { updateClinicAction } from "../actions"

export function EditClinicForm({ clinic }: { clinic: ClinicDTO }) {
  const [name, setName] = useState(clinic.name)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    setSaved(false)
    const res = await updateClinicAction(clinic.id, { name })
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

      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && <p className="text-sm text-muted-foreground">Saved.</p>}
      <Button type="submit" disabled={pending} className="h-11 text-base">
        {pending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  )
}
