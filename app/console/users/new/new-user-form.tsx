"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { createUserAction } from "../actions"
import { ROLE_LABEL } from "@/lib/dto/user"

type Form = {
  name: string
  email: string
  phone: string
  role: string
  branchId: string
  licenseNumber: string
  specialization: string
  consultationFeePesos: string
}

const initial: Form = {
  name: "",
  email: "",
  phone: "",
  role: "",
  branchId: "",
  licenseNumber: "",
  specialization: "",
  consultationFeePesos: "",
}

export function NewUserForm({
  roles,
  branches,
  showBranchPicker,
  defaultBranchId,
}: {
  roles: string[]
  branches: { id: string; name: string; clinic: { name: string } }[]
  showBranchPicker: boolean
  /** Preselected when arriving from a branch's staff section. */
  defaultBranchId?: string
}) {
  const [form, setForm] = useState<Form>({ ...initial, branchId: defaultBranchId ?? "" })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ name: string; tempPassword: string } | null>(null)

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  /**
   * Same reset the branch form needs: the inputs are controlled by `form`,
   * and a successful submit only sets `created`, so clearing that alone
   * brought the form back still holding the account just created — with the
   * previous person's name and email sitting under a fresh temporary
   * password. The preselected branch is kept, since that comes from the URL
   * the admin arrived on rather than from anything they typed.
   */
  function addAnother() {
    setCreated(null)
    setForm({ ...initial, branchId: defaultBranchId ?? "" })
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const res = await createUserAction(form)
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setCreated({ name: res.user.name, tempPassword: res.tempPassword })
  }

  if (created) {
    return (
      <Card>
        <CardContent className="py-6">
          <p className="text-sm">
            <strong>{created.name}</strong>&rsquo;s account is ready.
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            Temporary password — share this with them now. It can&rsquo;t be shown again after you leave this page.
          </p>
          <p className="mt-2 rounded-md border border-border bg-muted px-3 py-2 font-mono text-base">
            {created.tempPassword}
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            They&rsquo;ll be asked to set their own password the first time they sign in.
          </p>
          <div className="mt-4 flex gap-2">
            <Button type="button" variant="outline" onClick={addAnother}>
              Add another
            </Button>
            <Button type="button" asChild>
              <Link href="/console/users">Back to users</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  const showDoctorFields = form.role === "DOCTOR"
  const needsBranch = showBranchPicker && form.role !== "" && form.role !== "HOLDING_ADMIN"

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" required autoFocus value={form.name} onChange={(e) => set("name", e.target.value)} className="h-10" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required value={form.email} onChange={(e) => set("email", e.target.value)} className="h-10" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="phone">Phone (optional)</Label>
        <Input id="phone" name="phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} className="h-10" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="role">Role</Label>
        <select
          id="role"
          name="role"
          required
          value={form.role}
          onChange={(e) => set("role", e.target.value)}
          className="h-10 rounded-md border border-input bg-transparent px-3 text-sm"
        >
          <option value="">Select…</option>
          {roles.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
      </div>

      {needsBranch && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="branchId">Branch</Label>
          <select
            id="branchId"
            name="branchId"
            required
            value={form.branchId}
            onChange={(e) => set("branchId", e.target.value)}
            className="h-10 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="">Select…</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.clinic.name} — {b.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {showDoctorFields && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="licenseNumber">License number</Label>
            <Input
              id="licenseNumber"
              name="licenseNumber"
              required
              value={form.licenseNumber}
              onChange={(e) => set("licenseNumber", e.target.value)}
              className="h-10"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="specialization">Specialization (optional)</Label>
            <Input
              id="specialization"
              name="specialization"
              placeholder="General Practitioner"
              value={form.specialization}
              onChange={(e) => set("specialization", e.target.value)}
              className="h-10"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="consultationFeePesos">Consultation fee (₱)</Label>
            <Input
              id="consultationFeePesos"
              name="consultationFeePesos"
              type="number"
              min="0"
              step="0.01"
              required
              value={form.consultationFeePesos}
              onChange={(e) => set("consultationFeePesos", e.target.value)}
              className="h-10"
            />
          </div>
        </>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending} className="mt-2 h-11 text-base">
        {pending ? "Creating…" : "Create account"}
      </Button>
    </form>
  )
}
