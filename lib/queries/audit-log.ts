import type { Prisma } from "@prisma/client"
import { runWithRls } from "@/lib/db/rls"
import { ForbiddenError } from "@/lib/permissions/errors"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { resolveReportInstantRange, type DateRangeParams } from "@/lib/utils/report-dates"
import { toAuditLogDTO, type AuditLogDTO } from "@/lib/dto/audit-log"

/** Rows per page when the caller doesn't ask for a size. */
export const AUDIT_LOG_PAGE_SIZE_DEFAULT = 50

/**
 * Hard ceiling on `pageSize`. `audit_logs` is append-only and grows without
 * bound, so an unclamped `take` straight off a query string is a one-request
 * denial of service — `?pageSize=10000000` would try to materialize (and
 * render) the entire table. Oversized requests are clamped to this rather
 * than rejected, so a hand-edited URL still shows something useful.
 */
export const AUDIT_LOG_PAGE_SIZE_MAX = 200

/** Matches `Branch.timezone`'s schema default; only used when no branch exists at all. */
const DEFAULT_TIMEZONE = "Asia/Manila"

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

export type AuditLogFilters = DateRangeParams & {
  action?: string
  entityType?: string
  userId?: string
  branchId?: string
  /** Free text, matched against `entityId`. */
  q?: string
  page?: string | number
  pageSize?: string | number
}

/** The values actually applied, echoed back so the UI can re-render the form and build paging links. */
export type AppliedAuditLogFilters = {
  start: string
  end: string
  action: string
  entityType: string
  userId: string
  branchId: string
  q: string
}

export type AuditLogFilterOptions = {
  actions: string[]
  entityTypes: string[]
  branches: { id: string; name: string; clinicName: string }[]
  users: { id: string; name: string }[]
}

export type AuditLogPage = {
  rows: AuditLogDTO[]
  total: number
  page: number
  pageSize: number
  pageCount: number
  hasPrev: boolean
  hasNext: boolean
  /** The timezone the date-range filter was resolved in; the UI formats timestamps in it too. */
  timezone: string
  applied: AppliedAuditLogFilters
  options: AuditLogFilterOptions
}

function parsePositiveInt(value: string | number | undefined): number | null {
  if (value === undefined || value === null || value === "") return null
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n)) return null
  const truncated = Math.trunc(n)
  return truncated >= 1 ? truncated : null
}

/** Clamp, never trust. See `AUDIT_LOG_PAGE_SIZE_MAX`. */
export function clampPageSize(value: string | number | undefined): number {
  const parsed = parsePositiveInt(value)
  if (parsed === null) return AUDIT_LOG_PAGE_SIZE_DEFAULT
  return Math.min(parsed, AUDIT_LOG_PAGE_SIZE_MAX)
}

function trimmed(value: string | undefined): string {
  return (value ?? "").trim()
}

/**
 * §9's Holding Admin "audit log viewer", read-only over the append-only
 * `audit_logs` table.
 *
 * ── Why every read here is inside `runWithRls` ──────────────────────────
 * `audit_logs` carries a Postgres SELECT policy (see the
 * enable_rls_backstop/branch_rewrite_rls_policies migrations, which cover
 * it along with patients, queue entries, consultations, payments and the
 * rest — `users`, `doctors`, `clinics`, and `branches` are the exceptions
 * that have no policy, not the rule), and the app connects as the
 * non-superuser `webinar_app` role, so that policy actually bites. The
 * policy reads `app.branch_id` / `app.role`, and those session GUCs are
 * only ever set inside `runWithRls`. A SELECT issued through the bare
 * `prisma` client therefore returns **zero rows silently** — no error, no
 * warning, just a page that looks like nothing has ever happened. That
 * failure mode is indistinguishable from an empty table, which is why the
 * tests for this module assert on specific seeded rows rather than on a
 * non-empty array.
 *
 * ── Why the holding-company scope is applied here and not by RLS ────────
 * RLS is NOT the tenant boundary for this table. Its policy grants a blanket
 * `current_setting('app.role') = 'HOLDING_ADMIN'` bypass that says nothing
 * about *which* holding company the reader belongs to, so leaning on it
 * alone would show one owner every other owner's trail. §4 scopes a Holding
 * Admin to "all clinics under the holding company", so that narrowing has
 * to happen in this query — the same thing `getHoldingConsolidatedReport`
 * does for its branch list, one relation hop further now that branches sit
 * under clinics under holding companies.
 *
 * Doing it as a plain join would erase the rows with `branch_id IS NULL`
 * that §10 most wants kept, so `holdingScope` below spells out all three
 * shapes a visible row can take. See the comment on it.
 *
 * ── Does viewing the audit log write to the audit log? No. ──────────────
 * §10 requires a row "on every access to patient clinical data and every
 * financial record change". This screen is neither: it reads *metadata
 * about* those events — action names, entity types, ids, timestamps — and
 * never the clinical or financial content itself. Logging it would also be
 * self-amplifying in a way no other screen is: every page view and every
 * filter tweak would append a row into the very table being paged, so the
 * trail would fill with records of people reading the trail and crowd out
 * the clinical and financial history the table exists to preserve. It would
 * also turn a read-only route into a write path, which is a strictly larger
 * attack surface for a screen whose only job is to be trustworthy. The
 * counter-argument — an audit log nobody can audit is a gap — is real, but
 * the right answer to it is a separate access-log sink (or the
 * authentication log, which already records who signed in and from where),
 * not recursion into this table. If that ever becomes a compliance
 * requirement, add a distinct `audit_log_access` table rather than changing
 * this decision here.
 */
export async function listAuditLog(user: AbilitySubject, params: AuditLogFilters = {}): Promise<AuditLogPage> {
  // §4's role table gives "view audit log" to the Holding Admin only, and
  // proxy.ts lets CLINIC_ADMIN into /console too — so the narrowing has to
  // happen here. Throwing (rather than returning []) is required by §4.2 and
  // matters doubly on this table: an empty array is also what a broken RLS
  // setup produces, and the two must not look alike.
  if (user.role !== "HOLDING_ADMIN") throw new ForbiddenError("Only a holding admin can view the audit log")

  const pageSize = clampPageSize(params.pageSize)
  const requestedPage = parsePositiveInt(params.page) ?? 1

  // Unlike the reports screens, an unset date bound means "no bound" rather
  // than a default 30-day window — an audit trail that quietly hides
  // anything older than a month is worse than useless. Anything that isn't a
  // well-formed YYYY-MM-DD is treated as unset instead of falling back to
  // `resolveReportInstantRange`'s default, so garbage input can't silently
  // apply a range the user never asked for.
  const start = DATE_ONLY.test(trimmed(params.start)) ? trimmed(params.start) : ""
  const end = DATE_ONLY.test(trimmed(params.end)) ? trimmed(params.end) : ""
  const action = trimmed(params.action)
  const entityType = trimmed(params.entityType)
  const userId = trimmed(params.userId)
  const branchId = trimmed(params.branchId)
  const q = trimmed(params.q)

  // The tenant boundary, applied to every read below. A row is visible to
  // this holding admin if it is:
  //   1. attached to one of their holding company's branches, or
  //   2. branch-less but written by one of their own people (a holding-level
  //      action such as creating a HOLDING_ADMIN, which stores no branchId), or
  //   3. branch-less *and* user-less — a system/job row. `retention.purge`
  //      (lib/retention/purge.ts) is the only one today: it runs from the CLI
  //      with no session at all, so it has neither field to scope by.
  // Case 3 is the deliberate compromise: those rows are shown to every
  // holding admin, because the alternative is that a background job that
  // deletes patient records is auditable by nobody at all. With more than one
  // holding company that reveals aggregate purge counts across tenants — the
  // right fix then is a separate system-activity log, not dropping the rows.
  const holdingCompanyId = user.holdingCompanyId
  const holdingScope: Prisma.AuditLogWhereInput = {
    OR: [
      { branch: { clinic: { holdingCompanyId } } },
      { branchId: null, user: { holdingCompanyId } },
      { branchId: null, userId: null },
    ],
  }

  return runWithRls(user, async (tx) => {
    const branches = await tx.branch.findMany({
      where: { clinic: { holdingCompanyId } },
      select: { id: true, name: true, timezone: true, clinic: { select: { name: true } } },
      orderBy: [{ clinic: { name: "asc" } }, { name: "asc" }],
    })

    // Audit rows span every branch at once, so there is no single "correct"
    // branch timezone for the range. Use the filtered branch's when the user
    // picked one, otherwise the first branch's — in practice every branch is
    // Asia/Manila (§1), but nothing here assumes that.
    const timezone =
      (branchId ? branches.find((b) => b.id === branchId)?.timezone : undefined) ??
      branches[0]?.timezone ??
      DEFAULT_TIMEZONE

    // Reuse the reports helper for the timezone arithmetic (a calendar day
    // in Manila is not a UTC day), then keep only the bound the caller
    // actually supplied.
    const range = resolveReportInstantRange({ start: start || undefined, end: end || undefined }, timezone)
    const createdAt: { gte?: Date; lt?: Date } = {}
    if (start) createdAt.gte = range.start
    if (end) createdAt.lt = range.end // `end` is inclusive of its whole calendar day

    // holdingScope is AND-ed with the user's filters rather than merged into
    // them, so no filter value can widen what it allows. A hand-edited
    // `?branchId=<another owner's branch>` intersects to nothing instead of
    // reaching across the tenant boundary — the filters can only ever narrow.
    const where: Prisma.AuditLogWhereInput = {
      AND: [
        holdingScope,
        {
          ...(start || end ? { createdAt } : {}),
          ...(action ? { action } : {}),
          ...(entityType ? { entityType } : {}),
          ...(userId ? { userId } : {}),
          ...(branchId ? { branchId } : {}),
          ...(q ? { entityId: { contains: q, mode: "insensitive" } } : {}),
        },
      ],
    }

    // The count shares this transaction with the row read below, so it
    // reflects the same RLS-visible set the rows come from — a count taken
    // outside `runWithRls` would be 0 while the rows were not, and the
    // pager would silently disagree with the table.
    //
    // The action/entityType option lists are a DISTINCT over the whole
    // table rather than a hardcoded enum: the set of action strings grows
    // every time a feature adds an audited operation, and a literal list in
    // the UI would rot into a filter that can't select half the rows. They
    // are deliberately computed over the *unfiltered* table so narrowing on
    // one facet never empties the other's dropdown.
    // Every one of these is holding-scoped too. `users` and `branches` have
    // no RLS policy at all, so an unfiltered read here would list every
    // account name and every branch in the entire database to any holding
    // admin — the dropdowns would leak the tenant boundary even while the
    // table itself respected it.
    const [total, actionGroups, entityTypeGroups, users] = await Promise.all([
      tx.auditLog.count({ where }),
      tx.auditLog.groupBy({ by: ["action"], where: holdingScope, orderBy: { action: "asc" } }),
      tx.auditLog.groupBy({ by: ["entityType"], where: holdingScope, orderBy: { entityType: "asc" } }),
      tx.user.findMany({
        where: { OR: [{ branch: { clinic: { holdingCompanyId } } }, { holdingCompanyId }] },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    ])

    const pageCount = Math.max(1, Math.ceil(total / pageSize))
    // Clamp past-the-end requests to the last page rather than serving a
    // blank table with a live "next" link.
    const page = Math.min(requestedPage, pageCount)

    const rows = await tx.auditLog.findMany({
      where,
      select: {
        id: true,
        branchId: true,
        userId: true,
        action: true,
        entityType: true,
        entityId: true,
        changes: true,
        ipAddress: true,
        createdAt: true,
        branch: { select: { name: true } },
        user: { select: { name: true } },
      },
      // `createdAt desc` ALONE WOULD BE A BUG. Audit rows are routinely
      // written several-at-a-time inside one transaction and share a
      // timestamp to the microsecond; Postgres guarantees no particular
      // order among tied rows, so with skip/take the same row can come back
      // on two pages while another never appears at all. `id` is the unique
      // tiebreaker that makes the total order deterministic across the
      // separate queries a pager issues.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    })

    return {
      rows: rows.map(toAuditLogDTO),
      total,
      page,
      pageSize,
      pageCount,
      hasPrev: page > 1,
      hasNext: page < pageCount,
      timezone,
      applied: { start, end, action, entityType, userId, branchId, q },
      options: {
        actions: actionGroups.map((g) => g.action),
        entityTypes: entityTypeGroups.map((g) => g.entityType),
        branches: branches.map((b) => ({ id: b.id, name: b.name, clinicName: b.clinic.name })),
        users,
      },
    }
  })
}
