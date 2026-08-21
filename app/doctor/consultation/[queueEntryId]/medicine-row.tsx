"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import type { MedicineOptionDTO } from "@/lib/dto/medicine"

export type MedicineRowState = {
  key: string
  medicineId: string | null
  medicineName: string
  dosage: string
  quantity: string
  instructions: string
  dispensedFromStock: boolean
}

const FORM_LABEL: Record<string, string> = {
  TABLET: "tab",
  CAPSULE: "cap",
  SYRUP: "syrup",
  INJECTION: "inj",
  OINTMENT: "oint",
  OTHER: "",
}

export function MedicineRow({
  row,
  medicines,
  onChange,
  onRemove,
}: {
  row: MedicineRowState
  medicines: MedicineOptionDTO[]
  onChange: (patch: Partial<MedicineRowState>) => void
  onRemove: () => void
}) {
  const [searchOpen, setSearchOpen] = useState(false)

  const matches =
    searchOpen && row.medicineName.trim().length > 0
      ? medicines.filter((m) => m.name.toLowerCase().includes(row.medicineName.trim().toLowerCase())).slice(0, 8)
      : []

  const selected = row.medicineId ? medicines.find((m) => m.id === row.medicineId) : undefined
  const quantity = Number(row.quantity) || 0
  const remainingAfter = selected ? selected.currentStock - quantity : null
  const isLow = remainingAfter !== null && remainingAfter < (selected?.reorderLevel ?? 0)
  const isNegative = remainingAfter !== null && remainingAfter < 0

  function pick(m: MedicineOptionDTO) {
    onChange({ medicineId: m.id, medicineName: m.name, dispensedFromStock: true })
    setSearchOpen(false)
  }

  return (
    <div className="rounded-md border border-border p-3">
      <div className="relative">
        <Input
          value={row.medicineName}
          placeholder="Search or type a medicine name"
          onChange={(e) => {
            onChange({ medicineName: e.target.value, medicineId: null, dispensedFromStock: false })
            setSearchOpen(true)
          }}
          onFocus={() => setSearchOpen(true)}
          onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
        />
        {matches.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full rounded-md border border-border bg-popover text-popover-foreground shadow-md">
            {matches.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(m)}
                >
                  <span>
                    {m.name} {m.strength} <span className="text-muted-foreground">{FORM_LABEL[m.form]}</span>
                  </span>
                  <span className="font-numeric text-xs text-muted-foreground">{m.currentStock} left</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <Input placeholder="Dosage" value={row.dosage} onChange={(e) => onChange({ dosage: e.target.value })} className="h-9" />
        <Input
          type="number"
          min={1}
          placeholder="Quantity"
          value={row.quantity}
          onChange={(e) => onChange({ quantity: e.target.value })}
          className="h-9"
        />
      </div>
      <Input
        placeholder="Instructions (e.g. 1 tablet 3x a day after meals)"
        value={row.instructions}
        onChange={(e) => onChange({ instructions: e.target.value })}
        className="mt-2 h-9"
      />

      <div className="mt-2 flex items-center justify-between">
        <label className={`flex items-center gap-1.5 text-xs ${selected ? "" : "text-muted-foreground"}`}>
          <input
            type="checkbox"
            checked={row.dispensedFromStock}
            disabled={!selected}
            onChange={(e) => onChange({ dispensedFromStock: e.target.checked })}
          />
          Dispensed from clinic stock
        </label>
        <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
          Remove
        </Button>
      </div>

      {selected && row.dispensedFromStock && quantity > 0 && (
        <p className={`mt-1 text-xs ${isNegative ? "text-destructive" : isLow ? "text-priority" : "text-muted-foreground"}`}>
          {selected.currentStock} left → {remainingAfter} after
          {isNegative ? " — not enough stock" : isLow ? " — below reorder level" : ""}
        </p>
      )}
    </div>
  )
}
