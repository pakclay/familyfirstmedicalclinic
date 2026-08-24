"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { createClinicAction } from "../actions"

export function NewClinicForm() {
  const [name, setName] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const res = await createClinicAction({ name })
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setCreated({ id: res.clinic.id, name: res.clinic.name })
  }

  if (created) {
    return (
      <Card>
        <CardContent className="py-6">
          <p className="text-sm">
            <strong>{created.name}</strong> is set up.
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            Next, add a branch — the physical location patients actually book into.
          </p>
          <div className="mt-4 flex gap-2">
            <Button type="button" asChild>
              <Link href={`/console/clinics/${created.id}`}>Add a branch</Link>
            </Button>
            <Button type="button" variant="outline" asChild>
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
        <Input id="name" name="name" required autoFocus value={name} onChange={(e) => setName(e.target.value)} className="h-10" />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending} className="mt-2 h-11 text-base">
        {pending ? "Creating…" : "Create clinic"}
      </Button>
    </form>
  )
}
