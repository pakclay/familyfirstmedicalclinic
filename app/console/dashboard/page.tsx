import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getInventoryDashboardPanels } from "@/lib/queries/inventory"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { Badge } from "@/components/ui/badge"

export default async function DashboardPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  if (session.user.role !== "CLINIC_ADMIN") {
    // The panels below are branch-scoped, so they have nothing to show a
    // holding admin. Point at the two pages that do rather than leaving the
    // old "lands in M6" note, which outlived the reporting it promised.
    return (
      <div>
        <h1 className="text-2xl font-heading font-semibold">Dashboard</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The panels here are per-branch. For a company-wide view, see{" "}
          <Link href="/console/admin" className="underline">
            Administration
          </Link>{" "}
          for clinics, branches and accounts, or{" "}
          <Link href="/console/reports" className="underline">
            Reports
          </Link>{" "}
          for consolidated revenue and visits.
        </p>
      </div>
    )
  }

  const user: AbilitySubject = {
    id: session.user.id,
    role: session.user.role,
    branchId: session.user.branchId,
    holdingCompanyId: session.user.holdingCompanyId,
  }
  const panels = await getInventoryDashboardPanels(user)

  return (
    <div>
      <h1 className="text-2xl font-heading font-semibold">Dashboard</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Revenue and patient reports land in M6 — inventory health is ready now.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Panel title="Low stock" count={panels.lowStock.length} accent="priority">
          {panels.lowStock.map((m) => (
            <Link prefetch={false} key={m.id} href={`/staff/inventory/${m.id}`} className="flex justify-between px-4 py-2 text-sm hover:bg-accent">
              <span>{m.name}</span>
              <span className="font-numeric text-muted-foreground">
                {m.currentStock} / {m.reorderLevel}
              </span>
            </Link>
          ))}
        </Panel>

        <Panel title="Expiring soon (60 days)" count={panels.expiringSoon.length} accent="signal">
          {panels.expiringSoon.map((m) => (
            <Link prefetch={false} key={m.id} href={`/staff/inventory/${m.id}`} className="flex justify-between px-4 py-2 text-sm hover:bg-accent">
              <span>{m.name}</span>
              <span className="text-muted-foreground">
                {m.expiryDate?.toLocaleDateString("en-PH", { month: "short", day: "numeric" })}
              </span>
            </Link>
          ))}
        </Panel>

        {panels.expired.length > 0 && (
          <Panel title="Already expired" count={panels.expired.length} accent="destructive">
            {panels.expired.map((m) => (
              <Link prefetch={false} key={m.id} href={`/staff/inventory/${m.id}`} className="flex justify-between px-4 py-2 text-sm hover:bg-accent">
                <span>{m.name}</span>
                <span className="text-muted-foreground">
                  {m.expiryDate?.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}
                </span>
              </Link>
            ))}
          </Panel>
        )}
      </div>
    </div>
  )
}

function Panel({
  title,
  count,
  accent,
  children,
}: {
  title: string
  count: number
  accent: "priority" | "signal" | "destructive"
  children: React.ReactNode
}) {
  const accentClass = { priority: "border-priority text-priority", signal: "border-signal text-signal", destructive: "border-destructive text-destructive" }[accent]
  return (
    <div className="rounded-md border border-border">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h2 className="text-sm font-medium">{title}</h2>
        {count > 0 && (
          <Badge variant="outline" className={accentClass}>
            {count}
          </Badge>
        )}
      </div>
      <div className="divide-y divide-border">
        {count === 0 ? <p className="px-4 py-4 text-center text-sm text-muted-foreground">All clear.</p> : children}
      </div>
    </div>
  )
}
