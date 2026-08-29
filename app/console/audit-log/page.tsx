import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import {
  listAuditLog,
  AUDIT_LOG_PAGE_SIZE_DEFAULT,
  type AppliedAuditLogFilters,
} from "@/lib/queries/audit-log"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

const ROUTE = "/console/audit-log"
const SELECT_CLASS = "h-9 min-w-0 rounded-md border border-input bg-transparent px-2 text-sm"

type AuditLogSearchParams = {
  start?: string
  end?: string
  action?: string
  entityType?: string
  userId?: string
  branchId?: string
  q?: string
  page?: string
  pageSize?: string
}

/** Rebuilds the current URL with a different page, preserving every active filter. */
function hrefFor(applied: AppliedAuditLogFilters, pageSize: number, page: number): string {
  const sp = new URLSearchParams()
  for (const [key, value] of Object.entries(applied)) {
    if (value) sp.set(key, value)
  }
  if (pageSize !== AUDIT_LOG_PAGE_SIZE_DEFAULT) sp.set("pageSize", String(pageSize))
  if (page > 1) sp.set("page", String(page))
  const query = sp.toString()
  return query ? `${ROUTE}?${query}` : ROUTE
}

/**
 * `timezone` comes from a clinic row, so it's data rather than a constant —
 * an unrecognised zone would make the Intl constructor throw and take the
 * whole page with it.
 */
function buildTimestampFormatter(timezone: string): Intl.DateTimeFormat {
  const options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "medium" }
  try {
    return new Intl.DateTimeFormat("en-PH", { ...options, timeZone: timezone })
  } catch {
    return new Intl.DateTimeFormat("en-PH", options)
  }
}

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<AuditLogSearchParams> }) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  // proxy.ts admits CLINIC_ADMIN to /console as well, but §4's role table
  // gives "view audit log" to the Holding Admin alone. Refuse in place
  // rather than redirecting, the same way the expenses screen does — a
  // redirect would make a deliberate permission boundary look like a
  // broken link. `listAuditLog` throws for the same case independently.
  if (session.user.role !== "HOLDING_ADMIN") {
    return (
      <div>
        <h1 className="text-2xl font-heading font-semibold">Audit log</h1>
        <p className="mt-2 text-sm text-muted-foreground">Only a holding admin can view the audit log.</p>
      </div>
    )
  }

  const params = await searchParams
  const user: AbilitySubject = {
    id: session.user.id,
    role: session.user.role,
    branchId: session.user.branchId,
    holdingCompanyId: session.user.holdingCompanyId,
  }

  const result = await listAuditLog(user, params)
  const { applied, options, rows } = result
  const formatTimestamp = buildTimestampFormatter(result.timezone)
  const firstRowNumber = rows.length === 0 ? 0 : (result.page - 1) * result.pageSize + 1
  const lastRowNumber = (result.page - 1) * result.pageSize + rows.length
  const hasActiveFilter = Object.values(applied).some((value) => value !== "")

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-heading font-semibold">Audit log</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Every recorded action across all clinics. Read-only — audit entries are never edited or deleted.
      </p>

      <form className="mt-4 flex flex-wrap items-end gap-2" action={ROUTE}>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground" htmlFor="start">From</label>
          <Input id="start" name="start" type="date" defaultValue={applied.start} className="h-9" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground" htmlFor="end">To</label>
          <Input id="end" name="end" type="date" defaultValue={applied.end} className="h-9" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground" htmlFor="action">Action</label>
          <select id="action" name="action" defaultValue={applied.action} className={SELECT_CLASS}>
            <option value="">Any action</option>
            {options.actions.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground" htmlFor="entityType">Entity type</label>
          <select id="entityType" name="entityType" defaultValue={applied.entityType} className={SELECT_CLASS}>
            <option value="">Any type</option>
            {options.entityTypes.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground" htmlFor="branchId">Branch</label>
          <select id="branchId" name="branchId" defaultValue={applied.branchId} className={SELECT_CLASS}>
            <option value="">Any branch</option>
            {options.branches.map((branch) => (
              <option key={branch.id} value={branch.id}>{branch.clinicName} — {branch.name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground" htmlFor="userId">User</label>
          <select id="userId" name="userId" defaultValue={applied.userId} className={SELECT_CLASS}>
            <option value="">Any user</option>
            {options.users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground" htmlFor="q">Entity ID contains</label>
          <Input id="q" name="q" type="search" defaultValue={applied.q} placeholder="record id" className="h-9" />
        </div>
        {result.pageSize !== AUDIT_LOG_PAGE_SIZE_DEFAULT && (
          <input type="hidden" name="pageSize" value={String(result.pageSize)} />
        )}
        <Button type="submit" variant="outline" className="h-9">Filter</Button>
        {hasActiveFilter && (
          <Button asChild variant="ghost" className="h-9">
            <Link href={ROUTE}>Clear</Link>
          </Button>
        )}
      </form>

      <p className="mt-4 text-sm text-muted-foreground">
        {result.total === 0
          ? "No audit entries match these filters."
          : `Showing ${firstRowNumber}–${lastRowNumber} of ${result.total} · page ${result.page} of ${result.pageCount}`}
      </p>

      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[900px] table-fixed text-sm">
          <colgroup>
            <col className="w-[13rem]" />
            <col className="w-[11rem]" />
            <col className="w-[9rem]" />
            <col className="w-[12rem]" />
            <col className="w-[14rem]" />
            <col />
          </colgroup>
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="py-2 pr-3">When</th>
              <th className="py-2 pr-3">Who</th>
              <th className="py-2 pr-3">Branch</th>
              <th className="py-2 pr-3">Action</th>
              <th className="py-2 pr-3">Entity</th>
              <th className="py-2">Changes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-border align-top">
                <td className="py-2 pr-3 font-numeric text-xs">{formatTimestamp.format(row.createdAt)}</td>
                <td className="py-2 pr-3">
                  {/* A null user is normal (system-written rows); a null name
                      with a non-null id means the account is gone. Neither
                      may hide the entry. */}
                  <span className={row.userName ? "" : "text-muted-foreground"}>
                    {row.userName ?? (row.userId ? "Deleted user" : "System")}
                  </span>
                  {row.ipAddress && (
                    <span className="block truncate text-xs text-muted-foreground">{row.ipAddress}</span>
                  )}
                </td>
                <td className="py-2 pr-3">
                  {row.branchName ?? <span className="text-muted-foreground">—</span>}
                </td>
                <td className="py-2 pr-3 break-words">{row.action}</td>
                <td className="py-2 pr-3">
                  {row.entityType}
                  {row.entityId && (
                    <span className="block truncate font-numeric text-xs text-muted-foreground" title={row.entityId}>
                      {row.entityId}
                    </span>
                  )}
                </td>
                <td className="py-2">
                  {row.changes ? (
                    // `changes` is arbitrary JSON of arbitrary length — keep
                    // it inside its own scrollable box so one fat blob can't
                    // stretch the row or push the table sideways.
                    <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted px-2 py-1 text-xs">
                      {row.changes}
                    </pre>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-muted-foreground">
                  Nothing to show.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center gap-2">
        {result.hasPrev ? (
          <Button asChild variant="outline" size="sm">
            <Link href={hrefFor(applied, result.pageSize, result.page - 1)}>Previous</Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>Previous</Button>
        )}
        {result.hasNext ? (
          <Button asChild variant="outline" size="sm">
            <Link href={hrefFor(applied, result.pageSize, result.page + 1)}>Next</Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>Next</Button>
        )}
      </div>
    </div>
  )
}
