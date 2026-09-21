import Link from "next/link"
import { redirect } from "next/navigation"
import { format, parseISO } from "date-fns"
import { auth } from "@/auth"
import { getInventoryDashboardPanels } from "@/lib/queries/inventory"
import { getTodayQueueCounts } from "@/lib/queries/queue"
import { getBranchReport } from "@/lib/queries/reports/clinic"
import { getHoldingConsolidatedReport } from "@/lib/queries/reports/holding"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { formatPesos } from "@/lib/utils/billing"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { BarList } from "@/components/console/bar-list"
import { StatTile } from "@/components/console/stat-tile"
import { RevenueChart } from "@/app/console/reports/revenue-chart"

/**
 * The window behind every "recent" figure here. Seven days rather than the
 * reports' thirty: a dashboard answers "how is this week going", and the
 * full month with its date picker is one click away under Reports.
 */
const WINDOW_DAYS = 7

export default async function DashboardPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const user: AbilitySubject = {
    id: session.user.id,
    role: session.user.role,
    branchId: session.user.branchId,
    clinicId: session.user.clinicId,
    holdingCompanyId: session.user.holdingCompanyId,
  }

  if (session.user.role === "BRANCH_ADMIN") return <BranchDashboard user={user} />
  if (session.user.role === "HOLDING_ADMIN") return <HoldingDashboard user={user} />
  // A clinic admin has no dashboard (lib/nav.ts) but can still type the URL;
  // their home is /console/users, and / knows that.
  redirect("/")
}

/** §9 Branch Admin: "dashboard (including low-stock and expiring panels)". */
async function BranchDashboard({ user }: { user: AbilitySubject }) {
  const [counts, report, panels] = await Promise.all([
    getTodayQueueCounts(user),
    getBranchReport(user, { days: WINDOW_DAYS }),
    getInventoryDashboardPanels(user),
  ])
  // The window ends today, so today's bar is the last one; the tile leads
  // with it because it is the figure that still moves while this is open.
  const revenueToday = report.dailyRevenue.find((d) => d.date === report.endLabel)?.amount ?? 0

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Dashboard" subtitle={`${report.branchName} · ${format(parseISO(report.endLabel), "EEEE, d MMMM")}`}>
        <Button asChild variant="outline" size="sm">
          <Link href="/console/reports">Full report</Link>
        </Button>
      </PageHeader>

      <Section title="Today" aside={<SectionLink href="/staff/queue">Queue board</SectionLink>}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Waiting now" value={counts.waiting} hint={counts.expected > 0 ? `${counts.expected} booked, not here yet` : undefined} />
          <StatTile label="With doctor" value={counts.inConsultation} />
          <StatTile label="Seen today" value={counts.completed} />
          <StatTile label="Revenue today" value={formatPesos(revenueToday)} />
        </div>
      </Section>

      <Section title={`Last ${WINDOW_DAYS} days`} aside={<RangeLabel start={report.startLabel} end={report.endLabel} />}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Visits" value={report.visitCount} hint={`${report.newPatientCount} new · ${report.returningPatientCount} returning`} />
          <StatTile label="Revenue" value={formatPesos(report.revenueTotal)} />
          <StatTile label="Net" value={formatPesos(report.net)} hint={`${formatPesos(report.expensesTotal)} expenses`} />
          <StatTile
            label="Avg. wait"
            value={report.avgWaitMinutes !== null ? `${report.avgWaitMinutes} min` : "—"}
            hint={report.noShowRate !== null ? `${(report.noShowRate * 100).toFixed(0)}% no-show` : undefined}
          />
        </div>
        <div className="mt-3 rounded-md border border-border p-2 pt-3">
          <h3 className="px-2 text-sm font-medium text-muted-foreground">Revenue by day</h3>
          <RevenueChart data={report.dailyRevenue} />
        </div>
      </Section>

      <Section title="Inventory health" aside={<SectionLink href="/staff/inventory">Inventory</SectionLink>}>
        <div className="grid gap-4 sm:grid-cols-2">
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
      </Section>
    </div>
  )
}

/**
 * §9 Holding Admin: "consolidated dashboard". The same consolidated report
 * the Reports page draws from, over the short window, as headline figures
 * and two rankings — the full table, CSV and date picker stay on Reports.
 */
async function HoldingDashboard({ user }: { user: AbilitySubject }) {
  const report = await getHoldingConsolidatedReport(user, { days: WINDOW_DAYS })
  const visits = report.branches.reduce((n, b) => n + b.visitCount, 0)

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Dashboard" subtitle={`${report.branches.length} ${report.branches.length === 1 ? "branch" : "branches"} · last ${WINDOW_DAYS} days`}>
        <Button asChild variant="outline" size="sm">
          <Link href="/console/admin">Administration</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href="/console/reports">Full report</Link>
        </Button>
      </PageHeader>

      <Section title={`Last ${WINDOW_DAYS} days`} aside={<RangeLabel start={report.startLabel} end={report.endLabel} />}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Visits" value={visits} />
          <StatTile label="Revenue" value={formatPesos(report.consolidated.revenueTotal)} />
          <StatTile label="Expenses" value={formatPesos(report.consolidated.expensesTotal)} />
          <StatTile label="Net" value={formatPesos(report.consolidated.net)} />
        </div>
      </Section>

      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        <BarList
          title="Revenue by branch"
          emptyLabel="No branches yet."
          rows={report.rankingByRevenue.map((b) => ({
            key: b.branchId,
            label: b.branchName,
            sublabel: b.clinicName,
            value: b.revenueTotal,
            display: formatPesos(b.revenueTotal),
          }))}
        />
        <BarList
          title="Visits by branch"
          emptyLabel="No branches yet."
          rows={report.rankingByVolume.map((b) => ({
            key: b.branchId,
            label: b.branchName,
            sublabel: b.clinicName,
            value: b.visitCount,
            display: String(b.visitCount),
          }))}
        />
      </div>
    </div>
  )
}

function PageHeader({ title, subtitle, children }: { title: string; subtitle: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h1 className="text-2xl font-heading font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {children && <div className="flex gap-2">{children}</div>}
    </div>
  )
}

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-heading font-semibold">{title}</h2>
        {aside}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  )
}

function SectionLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="shrink-0 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
      {children} →
    </Link>
  )
}

function RangeLabel({ start, end }: { start: string; end: string }) {
  return (
    <span className="shrink-0 text-xs text-muted-foreground">
      {start} to {end}
    </span>
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
        <h3 className="text-sm font-medium">{title}</h3>
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
