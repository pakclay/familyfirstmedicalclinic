"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { IntakeForm } from "@/components/patients/intake-form"
import { createPatientFromIntake } from "@/lib/actions/patients"
import type { IntakeAnswers } from "@/lib/validation/patient"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"

export function NewPatientForm({ branches }: { branches: { id: string; name: string }[] }) {
  const router = useRouter()
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "")

  async function handle(values: IntakeAnswers) {
    if (!branchId) return { error: "Select a branch." }
    try {
      const patient = await createPatientFromIntake({ ...values, homeBranchId: branchId })
      router.push(`/console/patients/${patient.id}`)
      return { success: true }
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Could not create patient." }
    }
  }

  return (
    <div className="space-y-4">
      {branches.length > 1 ? (
        <div className="max-w-xs space-y-2">
          <Label>Branch</Label>
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Branch: {branches[0]?.name ?? "—"}</p>
      )}
      <IntakeForm onSubmit={handle} submitLabel="Create patient" successMessage="Patient created." />
    </div>
  )
}
