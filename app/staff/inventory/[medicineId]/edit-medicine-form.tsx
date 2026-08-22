"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import type { MedicineDetailDTO } from "@/lib/dto/medicine"
import { updateMedicineAction } from "./actions"

export function EditMedicineForm({ medicine }: { medicine: MedicineDetailDTO }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(formData: FormData) {
    setPending(true)
    setError(null)
    const input = {
      name: String(formData.get("name") ?? ""),
      genericName: String(formData.get("genericName") ?? ""),
      form: String(formData.get("form") ?? ""),
      strength: String(formData.get("strength") ?? ""),
      unit: String(formData.get("unit") ?? ""),
      reorderLevel: String(formData.get("reorderLevel") ?? ""),
      unitCost: Math.round(Number(formData.get("unitCostPesos") ?? 0) * 100),
      sellingPrice: Math.round(Number(formData.get("sellingPricePesos") ?? 0) * 100),
      isActive: formData.get("isActive") === "on",
    }
    const res = await updateMedicineAction(medicine.id, input)
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setOpen(false)
    router.refresh()
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Edit
      </Button>
    )
  }

  return (
    <Card className="mt-2">
      <CardContent className="py-4">
        <form action={handleSubmit} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name">
              <Input name="name" defaultValue={medicine.name} required className="h-9" />
            </Field>
            <Field label="Generic name">
              <Input name="genericName" defaultValue={medicine.genericName ?? ""} className="h-9" />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Form</Label>
              <select name="form" defaultValue={medicine.form} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm">
                <option value="TABLET">Tablet</option>
                <option value="CAPSULE">Capsule</option>
                <option value="SYRUP">Syrup</option>
                <option value="INJECTION">Injection</option>
                <option value="OINTMENT">Ointment</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <Field label="Strength">
              <Input name="strength" defaultValue={medicine.strength ?? ""} className="h-9" />
            </Field>
            <div className="flex flex-col gap-1.5">
              <Label>Unit</Label>
              <select name="unit" defaultValue={medicine.unit} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm">
                <option value="PIECE">Piece</option>
                <option value="BOTTLE">Bottle</option>
                <option value="VIAL">Vial</option>
                <option value="SACHET">Sachet</option>
                <option value="BOX">Box</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Reorder level">
              <Input name="reorderLevel" type="number" min={0} defaultValue={medicine.reorderLevel} className="h-9" />
            </Field>
            <Field label="Unit cost (₱)">
              <Input name="unitCostPesos" type="number" step="0.01" min={0} defaultValue={(medicine.unitCost / 100).toFixed(2)} className="h-9" />
            </Field>
            <Field label="Selling price (₱)">
              <Input name="sellingPricePesos" type="number" step="0.01" min={0} defaultValue={(medicine.sellingPrice / 100).toFixed(2)} className="h-9" />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="isActive" defaultChecked={medicine.isActive} />
            Active (visible in the consultation picker)
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={pending} className="h-9">
              {pending ? "Saving…" : "Save"}
            </Button>
            <Button type="button" variant="ghost" className="h-9" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  )
}
