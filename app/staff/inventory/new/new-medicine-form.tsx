"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { createMedicineAction } from "./actions"

export function NewMedicineForm() {
  const router = useRouter()
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
      reorderLevel: String(formData.get("reorderLevel") ?? "0"),
      unitCost: Math.round(Number(formData.get("unitCostPesos") ?? 0) * 100),
      sellingPrice: Math.round(Number(formData.get("sellingPricePesos") ?? 0) * 100),
      isActive: true,
    }
    const res = await createMedicineAction(input)
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    router.push(`/staff/inventory/${res.medicineId}`)
  }

  return (
    <Card>
      <CardContent className="py-4">
        <form action={handleSubmit} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name">
              <Input name="name" required autoFocus className="h-10" />
            </Field>
            <Field label="Generic name">
              <Input name="genericName" className="h-10" />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Form</Label>
              <select name="form" defaultValue="TABLET" className="h-10 rounded-md border border-input bg-transparent px-2 text-sm">
                <option value="TABLET">Tablet</option>
                <option value="CAPSULE">Capsule</option>
                <option value="SYRUP">Syrup</option>
                <option value="INJECTION">Injection</option>
                <option value="OINTMENT">Ointment</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <Field label="Strength">
              <Input name="strength" placeholder="e.g. 500mg" className="h-10" />
            </Field>
            <div className="flex flex-col gap-1.5">
              <Label>Unit</Label>
              <select name="unit" defaultValue="PIECE" className="h-10 rounded-md border border-input bg-transparent px-2 text-sm">
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
              <Input name="reorderLevel" type="number" min={0} defaultValue={10} className="h-10" />
            </Field>
            <Field label="Unit cost (₱)">
              <Input name="unitCostPesos" type="number" step="0.01" min={0} required className="h-10" />
            </Field>
            <Field label="Selling price (₱)">
              <Input name="sellingPricePesos" type="number" step="0.01" min={0} required className="h-10" />
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">
            Starts with 0 stock — use Receive stock afterward to bring in the first delivery.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={pending} className="h-10">
            {pending ? "Adding…" : "Add medicine"}
          </Button>
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
