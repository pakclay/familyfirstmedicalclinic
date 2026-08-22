"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import type { MedicineDispensedSummary } from "@/lib/dto/consultation"
import { deleteDispensedMedicineAction } from "./actions"

export function DispensedMedicineList({
  patientId,
  medicines,
  canDelete,
}: {
  patientId: string
  medicines: MedicineDispensedSummary[]
  canDelete: boolean
}) {
  const router = useRouter()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleDelete(medicineDispensedId: string) {
    const reason = window.prompt("Reason for this correction (required):")
    if (!reason || !reason.trim()) return
    setPendingId(medicineDispensedId)
    setError(null)
    const res = await deleteDispensedMedicineAction(patientId, medicineDispensedId, reason.trim())
    setPendingId(null)
    if (!res.ok) {
      setError(res.error)
      return
    }
    router.refresh()
  }

  return (
    <div>
      {medicines.map((m) => (
        <p key={m.id} className="flex items-center justify-between gap-2">
          <span>
            {m.medicineName}
            {m.dosage ? ` (${m.dosage})` : ""}
          </span>
          {canDelete && (
            <button
              type="button"
              disabled={pendingId === m.id}
              onClick={() => handleDelete(m.id)}
              className="text-destructive underline decoration-dotted hover:no-underline disabled:opacity-50"
            >
              Correct
            </button>
          )}
        </p>
      ))}
      {error && <p className="text-destructive">{error}</p>}
    </div>
  )
}
