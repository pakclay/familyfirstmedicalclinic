import { redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { getAdminOverview, type OverviewAccount } from "@/lib/queries/admin-overview"
import { ROLE_LABEL } from "@/lib/dto/user"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

export default async function AdminPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")
  // Refused in place rather than redirected: this is a top-level nav
  // destination, and bouncing a clinic admin to another page makes a
  // deliberate permission boundary look like a broken link. Same shape as
  // the clinics page's own gate.
  if (session.user.role !== "HOLDING_ADMIN") {
    return (
      <div>
        <h1 className="text-2xl font-heading font-semibold">Administration</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Only a holding admin administers clinics and accounts across the company.
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
  const overview = await getAdminOverview(user)
  const { totals, attention } = overview
  const nothingNeedsAttention =
    attention.lockedOut.length === 0 &&
    attention.mustChangePassword.length === 0 &&
    attention.clinicsWithoutBranches.length === 0 &&
    attention.branchesWithoutStaff.length === 0 &&
    attention.strandedInClosedBranch.length === 0

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-heading font-semibold">Administration</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {overview.company?.name ?? "Your company"} — every clinic, the branches under it, and who works there.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href="/console/clinics/new">Add clinic</Link>
          </Button>
          <Button asChild>
            <Link href="/console/users/new">Add user</Link>
          </Button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Clinics" value={totals.clinics} />
        <Stat label="Branches" value={totals.branches} note={totals.inactiveBranches > 0 ? `${totals.inactiveBranches} inactive` : undefined} />
        {/* "Accounts", not "Staff": this counts company-level admins too, so
            it is deliberately larger than the per-clinic staff numbers below,
            which only count people attached to a branch. */}
        <Stat
          label="Accounts"
          value={totals.staff}
          note={totals.inactiveStaff > 0 ? `${totals.inactiveStaff} deactivated` : undefined}
        />
        <Stat label="Locked out" value={totals.lockedOut} accent={totals.lockedOut > 0 ? "destructive" : undefined} />
        <Stat
          label="Must change password"
          value={totals.mustChangePassword}
          accent={totals.mustChangePassword > 0 ? "priority" : undefined}
        />
      </div>

      {/* Attention before structure: someone opening this page usually wants
          to know what is wrong, not to browse. Hidden entirely when there is
          nothing to act on, so it never becomes furniture people scroll past. */}
      {!nothingNeedsAttention && (
        <section className="mt-6">
          <p className="text-xs font-medium uppercase text-muted-foreground">Needs attention</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {attention.lockedOut.length > 0 && (
              <AttentionCard
                title="Locked out"
                total={totals.lockedOut}
                shown={attention.lockedOut.length}
                accent="destructive"
              >
                {attention.lockedOut.map((a) => (
                  <AccountRow key={a.id} account={a} />
                ))}
              </AttentionCard>
            )}

            {attention.mustChangePassword.length > 0 && (
              <AttentionCard
                title="Never changed their temporary password"
                total={totals.mustChangePassword}
                shown={attention.mustChangePassword.length}
                accent="priority"
              >
                {attention.mustChangePassword.map((a) => (
                  <AccountRow key={a.id} account={a} />
                ))}
              </AttentionCard>
            )}

            {attention.strandedInClosedBranch.length > 0 && (
              <AttentionCard
                title="Still active at a closed branch"
                total={totals.strandedInClosedBranch}
                shown={attention.strandedInClosedBranch.length}
                accent="destructive"
              >
                {attention.strandedInClosedBranch.map((a) => (
                  <AccountRow key={a.id} account={a} />
                ))}
              </AttentionCard>
            )}

            {attention.clinicsWithoutBranches.length > 0 && (
              <AttentionCard
                title="Clinics with no branch"
                total={attention.clinicsWithoutBranches.length}
                shown={attention.clinicsWithoutBranches.length}
                accent="signal"
              >
                {attention.clinicsWithoutBranches.map((c) => (
                  <Link
                    key={c.id}
                    href={`/console/clinics/${c.id}/branches/new`}
                    className="flex items-center justify-between px-4 py-2 text-sm hover:bg-accent"
                  >
                    <span className="truncate">{c.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">Add branch</span>
                  </Link>
                ))}
              </AttentionCard>
            )}

            {attention.branchesWithoutStaff.length > 0 && (
              <AttentionCard
                title="Active branches with no staff"
                total={attention.branchesWithoutStaff.length}
                shown={attention.branchesWithoutStaff.length}
                accent="signal"
              >
                {attention.branchesWithoutStaff.map((b) => (
                  <Link
                    key={b.id}
                    href={`/console/users/new?branchId=${b.id}`}
                    className="flex items-center justify-between gap-2 px-4 py-2 text-sm hover:bg-accent"
                  >
                    <span className="truncate">
                      {b.clinicName} — {b.name}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">Add user</span>
                  </Link>
                ))}
              </AttentionCard>
            )}
          </div>
        </section>
      )}

      <section className="mt-6">
        <p className="text-xs font-medium uppercase text-muted-foreground">Organization</p>
        <div className="mt-2 space-y-3">
          {overview.clinics.map((clinic) => (
            <div key={clinic.id} className="rounded-md border border-border">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
                <Link href={`/console/clinics/${clinic.id}`} className="font-medium hover:underline">
                  {clinic.name}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {clinic.branches.length} {clinic.branches.length === 1 ? "branch" : "branches"} ·{" "}
                  {clinic.staffCount} staff
                </span>
              </div>

              <ul className="divide-y divide-border">
                {clinic.branches.map((branch) => (
                  <li key={branch.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                    <div className="min-w-0">
                      <Link
                        href={`/console/clinics/${clinic.id}/branches/${branch.id}`}
                        className="text-sm hover:underline"
                      >
                        {branch.name}
                      </Link>
                      {!branch.isActive && <span className="ml-2 text-xs text-destructive">Inactive</span>}
                      <p className="truncate text-xs text-muted-foreground">
                        /{branch.slug} · {branch.city}
                      </p>
                    </div>
                    <span className="shrink-0 font-numeric text-xs text-muted-foreground">
                      {branch.staffCount} {branch.staffCount === 1 ? "person" : "people"}
                    </span>
                  </li>
                ))}
                {clinic.branches.length === 0 && (
                  <li className="px-4 py-3 text-center text-sm text-muted-foreground">
                    No branches yet —{" "}
                    <Link href={`/console/clinics/${clinic.id}/branches/new`} className="underline">
                      add one
                    </Link>
                    .
                  </li>
                )}
              </ul>
            </div>
          ))}

          {overview.clinics.length === 0 && (
            <div className="rounded-md border border-border px-4 py-6 text-center text-sm text-muted-foreground">
              No clinics yet.{" "}
              <Link href="/console/clinics/new" className="underline">
                Add the first one
              </Link>
              .
            </div>
          )}
        </div>
      </section>

      {/* Holding admins have no branchId, so they appear on no clinic page
          and no branch page. Without this section the only place to see them
          is the flat user list. */}
      <section className="mt-6">
        <p className="text-xs font-medium uppercase text-muted-foreground">Company-level accounts</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Holding admins aren&apos;t attached to a branch, so they don&apos;t appear under any clinic.
        </p>
        <div className="mt-2 divide-y divide-border rounded-md border border-border">
          {overview.holdingAccounts.map((a) => (
            <AccountRow key={a.id} account={a} />
          ))}
          {overview.holdingAccounts.length === 0 && (
            <p className="px-4 py-4 text-center text-sm text-muted-foreground">No company-level accounts.</p>
          )}
        </div>
      </section>
    </div>
  )
}

function Stat({
  label,
  value,
  note,
  accent,
}: {
  label: string
  value: number
  note?: string
  accent?: "destructive" | "priority"
}) {
  // Accent only when the number is worth looking at, so a healthy company
  // reads as visually quiet rather than alarming.
  const accentClass = accent === "destructive" ? "text-destructive" : accent === "priority" ? "text-priority" : ""
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <p className={`font-numeric text-lg ${accentClass}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  )
}

function AttentionCard({
  title,
  total,
  shown,
  accent,
  children,
}: {
  title: string
  total: number
  shown: number
  accent: "destructive" | "priority" | "signal"
  children: React.ReactNode
}) {
  const accentClass = {
    destructive: "border-destructive text-destructive",
    priority: "border-priority text-priority",
    signal: "border-signal text-signal",
  }[accent]
  return (
    <div className="rounded-md border border-border">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h2 className="text-sm font-medium">{title}</h2>
        <Badge variant="outline" className={accentClass}>
          {total}
        </Badge>
      </div>
      <div className="divide-y divide-border">{children}</div>
      {total > shown && (
        <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
          Showing {shown} of {total} —{" "}
          <Link href="/console/users" className="underline">
            see all accounts
          </Link>
          .
        </p>
      )}
    </div>
  )
}

/** A div, not an li — these render inside both a plain divide-y container and a list. */
function AccountRow({ account }: { account: OverviewAccount }) {
  return (
    <div className="px-4 py-2">
      <Link href={`/console/users/${account.id}`} className="text-sm font-medium hover:underline">
        {account.name}
      </Link>
      <p className="truncate text-xs text-muted-foreground">
        {account.email} · {ROLE_LABEL[account.role]}
        {account.branchName ? ` · ${account.branchName}` : ""}
      </p>
    </div>
  )
}
