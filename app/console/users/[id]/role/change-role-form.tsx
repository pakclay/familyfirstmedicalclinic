"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import type { Role } from "@prisma/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ROLE_LABEL } from "@/lib/dto/user"
import { ROLE_PROFILES } from "@/lib/permissions/role-capabilities"
import { changeUserRoleAction } from "../../actions"

const SELECT_CLASS = "h-10 rounded-md border border-input bg-transparent px-3 text-sm"

export function ChangeRoleForm({
  userId,
  userName,
  currentRole,
  currentBranchId,
  hasDoctorRecord,
  branches,
  clinics,
}: {
  userId: string
  userName: string
  currentRole: Role
  currentBranchId: string | null
  hasDoctorRecord: boolean
  branches: { id: string; name: string; clinic: { name: string } }[]
  /** For the clinic-admin role, which holds a clinic rather than a branch. */
  clinics: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [role, setRole] = useState<Role>(currentRole)
  const [branchId, setBranchId] = useState(currentBranchId ?? "")
  const [clinicId, setClinicId] = useState("")
  const [licenseNumber, setLicenseNumber] = useState("")
  const [specialization, setSpecialization] = useState("")
  const [consultationFeePesos, setConsultationFeePesos] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const changed = role !== currentRole
  const toHolding = role === "HOLDING_ADMIN"
  // A clinic admin is branchless too, but attached to a clinic: the branch
  // picker gives way to a clinic picker, and changeUserRole refuses the role
  // without one ("Select a clinic for this role.").
  const toClinic = role === "CLINIC_ADMIN"
  // Only a first-time promotion needs licence details — an account that was
  // a doctor before keeps its record, so re-promotion reuses it.
  const needsDoctorDetails = role === "DOCTOR" && !hasDoctorRecord
  const losingDoctorAccess = currentRole === "DOCTOR" && role !== "DOCTOR"

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const result = await changeUserRoleAction(userId, {
      role,
      branchId: toHolding || toClinic ? undefined : branchId,
      clinicId: toClinic ? clinicId : undefined,
      licenseNumber,
      specialization,
      consultationFeePesos,
    })
    setPending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    router.push(`/console/users/${userId}`)
    router.refresh()
  }

  const target = ROLE_PROFILES.find((p) => p.role === role)

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-md border border-border p-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="role">New role</Label>
        <select
          id="role"
          className={SELECT_CLASS}
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
        >
          {ROLE_PROFILES.map((p) => (
            <option key={p.role} value={p.role}>
              {p.label}
              {p.role === currentRole ? " (current)" : ""}
            </option>
          ))}
        </select>
        {target && <p className="text-xs text-muted-foreground">{target.summary}</p>}
      </div>

      {changed && !toHolding && !toClinic && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="branchId">Branch</Label>
          <select
            id="branchId"
            className={SELECT_CLASS}
            required
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
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

      {changed && toClinic && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="clinicId">Clinic</Label>
          <select
            id="clinicId"
            className={SELECT_CLASS}
            required
            value={clinicId}
            onChange={(e) => setClinicId(e.target.value)}
          >
            <option value="">Select…</option>
            {clinics.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            A clinic admin administers every branch under this clinic, and holds none of them.
          </p>
        </div>
      )}

      {changed && needsDoctorDetails && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="licenseNumber">Licence number</Label>
            <Input
              id="licenseNumber"
              required
              value={licenseNumber}
              onChange={(e) => setLicenseNumber(e.target.value)}
              className="h-10"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="specialization">Specialization (optional)</Label>
            <Input
              id="specialization"
              value={specialization}
              onChange={(e) => setSpecialization(e.target.value)}
              placeholder="General Practitioner"
              className="h-10"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="consultationFeePesos">Consultation fee (₱)</Label>
            <Input
              id="consultationFeePesos"
              type="number"
              min="1"
              step="0.01"
              required
              value={consultationFeePesos}
              onChange={(e) => setConsultationFeePesos(e.target.value)}
              className="h-10"
            />
          </div>
        </>
      )}

      {/* Consequences stated in the form, not left to the role list below —
          an admin should not have to scroll to learn what they are about to
          take away. */}
      {changed && (
        <div className="rounded-md border border-border bg-muted px-3 py-2 text-xs">
          <p className="font-medium">
            {userName} becomes {ROLE_LABEL[role]}
          </p>
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            {toHolding && <li>Loses their branch — a holding admin belongs to the whole company.</li>}
            {toHolding && <li>Gains every clinic, every branch and every account in the company.</li>}
            {toClinic && <li>Loses their branch — a clinic admin belongs to the clinic, not to any one branch.</li>}
            {toClinic && (
              <li>
                Gains account and branch management for every branch under the chosen clinic. No patient, queue, payment
                or stock access anywhere.
              </li>
            )}
            {losingDoctorAccess && <li>Loses the consultation screen. Their past consultations are kept.</li>}
            {losingDoctorAccess && <li>Stops appearing in the &ldquo;Assign doctor&rdquo; picker.</li>}
            {role === "DOCTOR" && hasDoctorRecord && <li>Their existing doctor record is reused.</li>}
            {currentRole === "HOLDING_ADMIN" && <li>Loses company-wide access and is confined to one branch.</li>}
          </ul>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={pending || !changed}>
          {pending ? "Saving…" : changed ? `Make ${ROLE_LABEL[role]}` : "No change"}
        </Button>
      </div>
    </form>
  )
}
