import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { listMedicines, type InventoryFilter } from "@/lib/queries/inventory"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

const FILTERS: { value: InventoryFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "low-stock", label: "Low stock" },
  { value: "expiring", label: "Expiring soon" },
  { value: "expired", label: "Expired" },
]

const FORM_LABEL: Record<string, string> = {
  TABLET: "Tablet",
  CAPSULE: "Capsule",
  SYRUP: "Syrup",
  INJECTION: "Injection",
  OINTMENT: "Ointment",
  OTHER: "Other",
}

export default async function InventoryListPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string }>
}) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (session.user.role === "HOLDING_ADMIN") {
    return (
      <div>
        <h1 className="text-2xl font-heading font-semibold">Inventory</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A holding admin isn&apos;t scoped to one clinic — inventory is tracked per clinic.
        </p>
      </div>
    )
  }

  const { q, filter } = await searchParams
  const activeFilter = (FILTERS.find((f) => f.value === filter)?.value ?? "all") as InventoryFilter
  const user: AbilitySubject = {
    id: session.user.id,
    role: session.user.role,
    clinicId: session.user.clinicId,
    holdingCompanyId: session.user.holdingCompanyId,
  }
  const medicines = await listMedicines(user, { search: q, filter: activeFilter === "all" ? undefined : activeFilter })
  const isClinicAdmin = session.user.role === "CLINIC_ADMIN"

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-heading font-semibold">Inventory</h1>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/staff/inventory/receive">Receive stock</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/staff/inventory/count">Physical count</Link>
          </Button>
          {isClinicAdmin && (
            <Button asChild size="sm">
              <Link href="/staff/inventory/new">Add medicine</Link>
            </Button>
          )}
        </div>
      </div>

      <form className="mt-4 flex gap-2" action="/staff/inventory">
        <Input name="q" placeholder="Search by name" defaultValue={q ?? ""} className="h-10" />
        {activeFilter !== "all" && <input type="hidden" name="filter" value={activeFilter} />}
        <Button type="submit" className="h-10">
          Search
        </Button>
      </form>

      <div className="mt-3 flex gap-1">
        {FILTERS.map((f) => (
          <Link
            key={f.value}
            href={{ pathname: "/staff/inventory", query: { ...(q ? { q } : {}), ...(f.value !== "all" ? { filter: f.value } : {}) } }}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${
              activeFilter === f.value ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <ul className="mt-4 divide-y divide-border rounded-md border border-border">
        {medicines.map((m) => (
          <li key={m.id}>
            <Link href={`/staff/inventory/${m.id}`} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-accent">
              <div>
                <p>
                  {m.name} {m.strength}
                  {m.isLowStock && (
                    <Badge variant="outline" className="ml-2 border-priority text-priority">
                      Low stock
                    </Badge>
                  )}
                  {m.isExpired && (
                    <Badge variant="outline" className="ml-2 border-destructive text-destructive">
                      Expired
                    </Badge>
                  )}
                  {!m.isExpired && m.isExpiringSoon && (
                    <Badge variant="outline" className="ml-2 border-signal text-signal">
                      Expiring soon
                    </Badge>
                  )}
                  {!m.isActive && (
                    <Badge variant="outline" className="ml-2">
                      Inactive
                    </Badge>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {FORM_LABEL[m.form]} · {m.unit.toLowerCase()} · reorder at {m.reorderLevel}
                </p>
              </div>
              <span className="font-numeric text-muted-foreground">{m.currentStock} left</span>
            </Link>
          </li>
        ))}
        {medicines.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">No medicines match.</li>
        )}
      </ul>
    </div>
  )
}
