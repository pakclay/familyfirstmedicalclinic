import type { AuditLog, Prisma } from "@prisma/client"

/**
 * Explicit field allowlist over the `AuditLog` model — never a raw row
 * passthrough. Almost everything here is nullable on purpose and the UI has
 * to survive all of it:
 *
 *  - `branchId`/`branchName` are null for holding-level actions that aren't
 *    tied to one branch (the RLS migration calls this case out by name).
 *  - `userId` is null for rows written by a system/background path with no
 *    acting user; `userName` is *additionally* null when the user row is no
 *    longer joinable (deleted, or invisible to the reader). A row whose
 *    author is gone still has to render — losing the entry entirely would
 *    defeat the point of an append-only trail.
 *  - `entityId`, `changes` and `ipAddress` are all nullable columns.
 */
export type AuditLogDTO = {
  id: string
  branchId: string | null
  branchName: string | null
  userId: string | null
  userName: string | null
  action: string
  entityType: string
  entityId: string | null
  changes: string | null
  ipAddress: string | null
  createdAt: Date
}

/**
 * The exact shape `toAuditLogDTO` needs — a `Pick` over the Prisma model so
 * a schema change to any of these columns breaks here rather than silently
 * changing what the viewer shows, plus the two optional relations.
 */
export type AuditLogRow = Pick<
  AuditLog,
  "id" | "branchId" | "userId" | "action" | "entityType" | "entityId" | "changes" | "ipAddress" | "createdAt"
> & {
  branch: { name: string } | null
  user: { name: string } | null
}

/**
 * `AuditLog.changes` is an untyped `Json?` column and every writer in the
 * app puts a different shape in it (`{ amount }` from expenses, `{ from,
 * to }` from a queue reorder, and so on). There is no single interface to
 * cast it to, and casting an unvalidated JSON blob to an invented type is
 * exactly the lie that makes a viewer crash on the one row that doesn't fit
 * — so normalize defensively to a display string instead, and let the
 * caller decide how to lay it out.
 *
 * Numbers are stringified verbatim. Money is stored as integer centavos
 * throughout this codebase, and a `changes` blob carrying an amount is
 * carrying centavos — deliberately not divided by 100 or currency-formatted
 * here, because this function cannot tell an amount from a quantity, a
 * stock count, or a queue position, and guessing wrong would misreport the
 * audited value by two orders of magnitude.
 */
export function normalizeChanges(value: Prisma.JsonValue | null | undefined): string | null {
  // Covers both a SQL NULL column and a stored JSON `null`.
  if (value === null || value === undefined) return null
  if (typeof value === "string") return value.length > 0 ? value : null
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  try {
    const text = JSON.stringify(value)
    if (text === undefined || text === "null" || text === "{}" || text === "[]") return null
    return text
  } catch {
    // JSON from Postgres can't be circular, but a driver-level surprise
    // here must not take down a page whose whole job is being readable.
    return "[unreadable]"
  }
}

export function toAuditLogDTO(row: AuditLogRow): AuditLogDTO {
  return {
    id: row.id,
    branchId: row.branchId,
    branchName: row.branch?.name ?? null,
    userId: row.userId,
    userName: row.user?.name ?? null,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    changes: normalizeChanges(row.changes),
    ipAddress: row.ipAddress,
    createdAt: row.createdAt,
  }
}
