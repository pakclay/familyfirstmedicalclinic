import { redirect, notFound } from "next/navigation"
import { auth } from "@/auth"
import { getMedicineWithLedger } from "@/lib/queries/inventory"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { Badge } from "@/components/ui/badge"
import { EditMedicineForm } from "./edit-medicine-form"

const MOVEMENT_LABEL: Record<string, string> = {
  RECEIPT: "Receipt",
  DISPENSE: "Dispense",
  ADJUSTMENT: "Adjustment",
  RETURN: "Return",
  EXPIRED: "Expired",
  DAMAGED: "Damaged",
}

export default async function MedicineDetailPage({ params }: { params: Promise<{ medicineId: string }> }) {
  const { medicineId } = await params
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (session.user.role === "HOLDING_ADMIN") redirect("/staff/inventory")

  const user: AbilitySubject = {
    id: session.user.id,
    role: session.user.role,
    clinicId: session.user.clinicId,
    holdingCompanyId: session.user.holdingCompanyId,
  }
  const result = await getMedicineWithLedger(user, medicineId)
  if (!result) notFound()
  const { medicine, ledger } = result

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-heading font-semibold">
            {medicine.name} {medicine.strength}
          </h1>
          <p className="text-sm text-muted-foreground">
            {medicine.genericName && `${medicine.genericName} · `}
            {medicine.form.toLowerCase()} · {medicine.unit.toLowerCase()}
          </p>
        </div>
        <div className="flex gap-1">
          {medicine.isLowStock && (
            <Badge variant="outline" className="border-priority text-priority">
              Low stock
            </Badge>
          )}
          {medicine.isExpired && (
            <Badge variant="outline" className="border-destructive text-destructive">
              Expired
            </Badge>
          )}
          {!medicine.isExpired && medicine.isExpiringSoon && (
            <Badge variant="outline" className="border-signal text-signal">
              Expiring soon
            </Badge>
          )}
        </div>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">Current stock</dt>
          <dd className="font-numeric text-lg">{medicine.currentStock}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Reorder level</dt>
          <dd className="font-numeric text-lg">{medicine.reorderLevel}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Unit cost</dt>
          <dd className="font-numeric text-lg">₱{(medicine.unitCost / 100).toFixed(2)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Selling price</dt>
          <dd className="font-numeric text-lg">₱{(medicine.sellingPrice / 100).toFixed(2)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Expiry</dt>
          <dd>{medicine.expiryDate ? medicine.expiryDate.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" }) : "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Status</dt>
          <dd>{medicine.isActive ? "Active" : "Inactive"}</dd>
        </div>
      </dl>

      {session.user.role === "CLINIC_ADMIN" && (
        <div className="mt-4">
          <EditMedicineForm medicine={medicine} />
        </div>
      )}

      <h2 className="mt-8 text-lg font-heading font-semibold">Movement ledger</h2>
      <p className="text-sm text-muted-foreground">
        Every receipt, dispense, adjustment, and return — {ledger.length} entr{ledger.length === 1 ? "y" : "ies"}.
      </p>
      <ul className="mt-3 divide-y divide-border rounded-md border border-border">
        {ledger.map((m) => (
          <li key={m.id} className="px-4 py-2.5 text-sm">
            <div className="flex items-center justify-between">
              <span>
                {MOVEMENT_LABEL[m.movementType]}
                {m.referenceType && <span className="text-muted-foreground"> · {m.referenceType}</span>}
              </span>
              <span className={`font-numeric ${m.quantityChange < 0 ? "text-priority" : "text-brand"}`}>
                {m.quantityChange > 0 ? "+" : ""}
                {m.quantityChange} → {m.balanceAfter}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {m.performedByName} · {m.createdAt.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}
              {m.reason && ` · ${m.reason}`}
            </p>
          </li>
        ))}
        {ledger.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">No movements yet.</li>
        )}
      </ul>
    </div>
  )
}
