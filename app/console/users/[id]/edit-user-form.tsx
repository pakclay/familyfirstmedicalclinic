"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { UserDTO } from "@/lib/dto/user"
import { updateUserAction } from "../actions"

export function EditUserForm({
  user,
  branches,
  showBranchPicker,
}: {
  user: UserDTO
  branches: { id: string; name: string; clinic: { name: string } }[]
  showBranchPicker: boolean
}) {
  const [name, setName] = useState(user.name)
  const [phone, setPhone] = useState(user.phone ?? "")
  const [branchId, setBranchId] = useState(user.branchId ?? "")
  const [licenseNumber, setLicenseNumber] = useState(user.doctor?.licenseNumber ?? "")
  const [specialization, setSpecialization] = useState(user.doctor?.specialization ?? "")
  const [consultationFeePesos, setConsultationFeePesos] = useState(
    user.doctor ? String(user.doctor.consultationFeePesos) : ""
  )
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    setSaved(false)
    const res = await updateUserAction(user.id, {
      name,
      phone,
      licenseNumber,
      specialization,
      consultationFeePesos,
      // Omitted entirely when the picker isn't shown, so the payload stays
      // "no branch change requested" rather than posting a value the server
      // would have to recognise as a no-op.
      ...(showBranchPicker ? { branchId } : {}),
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
        <Label htmlFor="phone">Phone (optional)</Label>
        <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} className="h-10" />
      </div>

      {showBranchPicker && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="branchId">Branch</Label>
          <select
            id="branchId"
            name="branchId"
            required
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="h-10 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="">Select…</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.clinic.name} — {b.name}
              </option>
            ))}
          </select>
          {branchId !== (user.branchId ?? "") && (
            <p className="text-xs text-muted-foreground">
              Moves this account to another branch. Past records stay with the branch they happened in.
            </p>
          )}
        </div>
      )}

      {user.doctor && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="licenseNumber">License number</Label>
            <Input
              id="licenseNumber"
              value={licenseNumber}
              onChange={(e) => setLicenseNumber(e.target.value)}
              className="h-10"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="specialization">Specialization</Label>
            <Input
              id="specialization"
              value={specialization}
              onChange={(e) => setSpecialization(e.target.value)}
              className="h-10"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="consultationFeePesos">Consultation fee (₱)</Label>
            <Input
              id="consultationFeePesos"
              type="number"
              min="0"
              step="0.01"
              value={consultationFeePesos}
              onChange={(e) => setConsultationFeePesos(e.target.value)}
              className="h-10"
            />
          </div>
        </>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && <p className="text-sm text-muted-foreground">Saved.</p>}
      <Button type="submit" disabled={pending} className="h-11 text-base">
        {pending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  )
}
