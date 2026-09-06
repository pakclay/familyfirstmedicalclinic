import type { Prisma } from "@prisma/client"
import { prisma } from "./prisma"
import type { AbilitySubject } from "@/lib/permissions/ability"

/**
 * Sets all three GUCs in a single statement — one database round trip
 * rather than three. These used to be three separate `$executeRaw` calls,
 * which read more clearly but cost two extra sequential round trips inside
 * every one of the ~96 scoped queries in the app. That is invisible against
 * a local Postgres and expensive against a managed database in another
 * region, where it was measurably a large share of each console render.
 *
 * `set_config(..., true)` keeps its `is_local` semantics when several are
 * projected by one SELECT: all three are still scoped to the surrounding
 * transaction and are gone once it commits.
 */
function setScope(
  tx: Prisma.TransactionClient,
  role: string,
  userId: string,
  branchId: string,
  clinicId: string
): Promise<number> {
  // app.clinic_id is read by exactly one policy: audit_logs' INSERT, so a
  // branchless clinic admin can write the audit row for an account or
  // branch it just created under its own clinic (see the
  // audit_logs_clinic_admin_insert migration). It widens nothing else —
  // every SELECT policy still keys on app.branch_id, and this role has none.
  return tx.$executeRaw`SELECT
    set_config('app.role', ${role}, true),
    set_config('app.user_id', ${userId}, true),
    set_config('app.branch_id', ${branchId}, true),
    set_config('app.clinic_id', ${clinicId}, true)`
}

/**
 * Appends an audit_logs row WITHOUT `RETURNING`.
 *
 * Postgres requires a row returned by `INSERT ... RETURNING` to also pass
 * the table's SELECT policy — and audit_logs' SELECT policy deliberately has
 * no arm for a branchless CLINIC_ADMIN (its rows carry patient.read
 * entityIds this role must never see). Prisma's `create` always emits
 * RETURNING, so `tx.auditLog.create(...)` by a clinic admin fails with 42501
 * even though the INSERT policy admits the row — the write is allowed, the
 * read-back is not. `createMany` emits a bare INSERT and returns a count.
 *
 * Takes the same `{ data }` shape as `create` so a call site changes one
 * token and nothing else. Nothing in this codebase reads an audit row back
 * from its own write, so nothing is lost. Reproduced against a live
 * database: identical INSERT, OK without RETURNING, 42501 with it.
 */
export function appendAuditLog(
  tx: Prisma.TransactionClient,
  args: { data: Prisma.AuditLogUncheckedCreateInput }
): Promise<Prisma.BatchPayload> {
  return tx.auditLog.createMany({ data: [args.data] })
}

/**
 * Runs `fn` inside a Postgres transaction with the RLS session GUCs
 * (app.role / app.user_id / app.branch_id) set via SET LOCAL, so the
 * policies in the enable_rls_backstop/branch_rewrite_rls_policies
 * migrations can see who's asking. SET LOCAL is transaction-scoped and
 * never leaks across pooled connections — safe under Prisma's connection
 * pooling.
 *
 * This only actually restricts anything if the Prisma client is connected
 * as the non-superuser `webinar_app` role (APP_DATABASE_URL) — see
 * lib/db/prisma.ts and DECISIONS.md.
 */
export async function runWithRls<T>(
  user: AbilitySubject,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await setScope(tx, user.role, user.id, user.branchId ?? "", user.clinicId ?? "")
    return fn(tx)
  })
}

/**
 * Same RLS-scoping mechanism as `runWithRls`, for the handful of routes
 * with no authenticated user at all: public booking (§7.1), the public
 * display screen, and the patient status page (§4: "Patients never
 * authenticate"). Every branch-scoped RLS policy's condition is
 * `branch_id = app.branch_id OR app.role = 'HOLDING_ADMIN'` — the role GUC
 * only matters for that second branch, so a public caller just needs
 * `app.branch_id` set to the target branch and any role string that isn't
 * `'HOLDING_ADMIN'` to hit the first branch on its own merits.
 */
export async function runWithBranchScope<T>(
  branchId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await setScope(tx, "PUBLIC", "", branchId, "")
    return fn(tx)
  })
}

/**
 * Full cross-branch visibility — used *only* for looking up a queue entry
 * by its access token (§7.3 `/q/{access_token}`). Token possession *is*
 * the authorization there (§10: cryptographically random, single-purpose,
 * unguessable), so there's no branch to scope RLS by until after the row
 * is already found — the lookup has to see across all branches to find it
 * at all. Only ever call this for a single `findUnique`/`findFirst` keyed
 * by the unguessable token itself; never for a list or any query whose
 * `where` a caller could otherwise influence.
 */
export async function runWithFullVisibility<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await setScope(tx, "HOLDING_ADMIN", "", "", "")
    return fn(tx)
  })
}
