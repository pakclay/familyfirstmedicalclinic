import { randomUUID } from "crypto"
import { prisma } from "@/lib/db/prisma"
import { appendAuditLog } from "@/lib/db/rls"
import { rateLimitKey, UNKNOWN_SOURCE } from "./key"
import { rateLimitMessage, type RateLimitSurface } from "./policy"

/**
 * Per-source (client IP) rate limiting for the two unauthenticated entry
 * points: the login action and the public booking action. Per-ACCOUNT
 * lockout (lib/queries/users.ts) is a separate control and is untouched by
 * this file — see lib/rate-limit/policy.ts for why both exist.
 *
 * ── Why the bare `prisma` client, with no runWithRls ────────────────────
 * This runs BEFORE authentication. There is no session, no
 * `AbilitySubject`, and none of the `app.role` / `app.user_id` /
 * `app.branch_id` / `app.clinic_id` session GUCs that lib/db/rls.ts sets — there is nothing
 * to scope by, because the entire point is to limit callers who have not
 * proved who they are. So every statement below goes through the plain
 * client from lib/db/prisma.ts.
 *
 * That is only safe because `rate_limits` carries NO RLS POLICY. It is
 * deliberately absent from the branch_rewrite_rls_policies migration (see the
 * comment on the model in prisma/schema.prisma). Enabling RLS on that
 * table later would break every write here — and would do it *silently*
 * for reads, which is the dangerous half: a limiter that can no longer see
 * its own counters allows everything while looking perfectly healthy.
 *
 * This is the exact inverse of lib/queries/audit-log.ts, which MUST use
 * `runWithRls` — `audit_logs` does have a SELECT policy, so an unwrapped
 * read there returns zero rows with no error at all. Same client, opposite
 * requirement, decided per table by whether that table has a policy.
 */

export type RateLimitDecision = {
  /** False only when the caller has spent its budget for the current window. */
  allowed: boolean
  /** The counter row's primary key — `"<surface>:<ip>"`. */
  key: string
  /** The derived source, or null when the request had no trustworthy address. */
  ip: string | null
  /** Attempts recorded in the current window, this one included. */
  count: number
  limit: number
  /** Milliseconds until the current window ends. Meaningful when `allowed` is false. */
  retryAfterMs: number
  /** True only on the single request that crossed the threshold — see the audit note below. */
  firstBlock: boolean
  /** True when the limiter itself failed and the request was let through. See the fail-open note. */
  degraded: boolean
}

type ConsumeRow = { count: number; window_start: Date }

/**
 * Records one attempt against `surface` from `ip` and reports whether it
 * is allowed.
 *
 * ── Why one raw statement and not prisma.upsert ─────────────────────────
 * THE INCREMENT MUST BE ATOMIC. The obvious Prisma shapes are both wrong
 * under concurrency:
 *
 *   - `findUnique` then `update` is a read-modify-write across two round
 *     trips. Two requests that both read count = 4 both write 5, so the
 *     attacker gets two attempts for the price of one — and repeating that
 *     in parallel lets them exceed any threshold by as much as they like.
 *     Adding a transaction does not fix it either: at Postgres's default
 *     READ COMMITTED isolation both transactions still read the same 4.
 *   - `prisma.upsert` looks atomic but is not. Prisma implements it as a
 *     `SELECT`, then an `INSERT` or `UPDATE`, so it has the same gap plus
 *     a unique-violation race on first use. Its `update` branch also
 *     cannot express "increment, but reset to 1 if the window rolled" —
 *     that decision depends on the row's current value, which Prisma's
 *     `update` data cannot read.
 *
 * A single `INSERT … ON CONFLICT ("key") DO UPDATE … RETURNING` does the
 * lookup, the window roll, the increment, and the read of the result in
 * one statement. Postgres takes a row lock on conflict, so concurrent
 * callers serialise on that one row and each sees a distinct count. The
 * `CASE` on `window_start` is what makes it a rolling fixed window: if the
 * stored window opened before the cutoff it is stale, so the row restarts
 * at 1 with a new window; otherwise the count goes up and the window start
 * is left alone.
 *
 * Leaving `window_start` alone while blocked is deliberate — the block
 * expires a fixed window after the first attempt, so a source that keeps
 * hammering cannot push out its own release time indefinitely, and cannot
 * be pushed out by anyone else sharing its address either.
 *
 * `now` is a parameter so tests can roll the window without sleeping for
 * fifteen minutes. Timestamps are bound as ISO strings and cast with
 * `::timestamp`: the columns are `timestamp(3)` (no zone) holding UTC, and
 * an explicit cast of an ISO-8601 string is the one form whose meaning
 * does not depend on the session's TimeZone setting.
 */
export async function consumeRateLimit(
  surface: RateLimitSurface,
  ip: string | null,
  now: Date = new Date()
): Promise<RateLimitDecision> {
  const key = rateLimitKey(surface.name, ip)
  const nowIso = now.toISOString()
  const cutoffIso = new Date(now.getTime() - surface.windowMs).toISOString()

  try {
    const rows = await prisma.$queryRaw<ConsumeRow[]>`
      INSERT INTO "rate_limits" ("key", "count", "window_start", "created_at", "updated_at")
      VALUES (${key}, 1, ${nowIso}::timestamp, ${nowIso}::timestamp, ${nowIso}::timestamp)
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE
          WHEN "rate_limits"."window_start" <= ${cutoffIso}::timestamp THEN 1
          ELSE "rate_limits"."count" + 1
        END,
        "window_start" = CASE
          WHEN "rate_limits"."window_start" <= ${cutoffIso}::timestamp THEN ${nowIso}::timestamp
          ELSE "rate_limits"."window_start"
        END,
        "updated_at" = ${nowIso}::timestamp
      RETURNING "count", "window_start"
    `

    const row = rows[0]
    const count = Number(row.count)
    const retryAfterMs = Math.max(0, row.window_start.getTime() + surface.windowMs - now.getTime())
    const allowed = count <= surface.limit
    // The (limit + 1)-th request is the first refusal. Exactly one request
    // per key per window can satisfy this, which is what bounds the audit
    // writes below.
    const firstBlock = count === surface.limit + 1

    if (ip === null && process.env.NODE_ENV === "production") {
      // Not a hot path: in a correct deployment this never fires at all,
      // and when it does it fires once per request on a surface that is
      // already being throttled. See `rateLimitKey` for why header-less
      // requests share a bucket instead of being skipped or refused.
      console.error(
        `[rate-limit] No trustworthy client IP on a "${surface.name}" request — falling back to the shared "${UNKNOWN_SOURCE}" bucket. Check that the deployment's proxy sets x-vercel-forwarded-for / x-real-ip / x-forwarded-for and that the origin is not reachable directly.`
      )
    }

    if (firstBlock) await auditFirstBlock(surface, ip, count, now)

    return { allowed, key, ip, count, limit: surface.limit, retryAfterMs, firstBlock, degraded: false }
  } catch (err) {
    // ── FAIL OPEN ────────────────────────────────────────────────────────
    // If the limiter's own query throws — database down, pool exhausted,
    // lock timeout — the request proceeds.
    //
    // The reason this is safe here specifically: neither protected
    // operation can succeed without the very same database. Signing in
    // reads `users` through Prisma (auth.ts) and booking writes patient
    // and queue rows (lib/queries/booking.ts). An attacker who breaks the
    // database to disable this counter has also broken the thing they were
    // attacking, so fail-open surrenders nothing they could use.
    //
    // Fail-closed, by contrast, would buy nothing and cost plenty: a
    // transient error on *this one statement* — a lock wait on a single
    // hot row is the obvious candidate — would refuse logins that would
    // otherwise have worked, turning a database hiccup into a clinic that
    // cannot open its queue with patients already in the waiting room.
    // Refusing care to keep a counter honest is the wrong trade.
    //
    // Logged loudly, because a limiter that has quietly stopped limiting
    // is precisely the state nobody notices.
    console.error(`[rate-limit] "${surface.name}" check failed; allowing the request (fail-open).`, err)
    return {
      allowed: true,
      key,
      ip,
      count: 0,
      limit: surface.limit,
      retryAfterMs: 0,
      firstBlock: false,
      degraded: true,
    }
  }
}

/**
 * ── Is a block audited? Only the transition into one ────────────────────
 * Yes, but exactly once per key per window: on the request that crosses
 * the threshold, never on the ones after it. Auditing every refusal would
 * hand an attacker a way to append an unbounded number of rows to
 * `audit_logs` just by continuing to hammer a surface they are already
 * blocked on — a denial of service against the audit trail itself, using
 * the security control as the weapon. One row per key per window keeps the
 * write volume bounded by the same thing that bounds the counter table:
 * the number of distinct sources.
 *
 * ── Why appendAuditLog and not prisma.auditLog.create ───────────────────
 * `audit_logs` DOES have RLS (unlike `rate_limits`), and there are no
 * session GUCs here. Its INSERT policy's first arm is `branch_id IS NULL`
 * (prisma/migrations/…audit_logs_clinic_admin_insert), so an anonymous
 * system row is permitted — verified against the running database as the
 * `webinar_app` role.
 *
 * But `prisma.auditLog.create()` still FAILS here: Prisma emits
 * `INSERT … RETURNING`, and Postgres applies the SELECT policy to the
 * returned row. With no GUCs set that policy matches nothing, and the error
 * is the thoroughly misleading `new row violates row-level security policy`
 * (42501) — a WITH CHECK message for what is really a RETURNING problem.
 * This file was the first place in the codebase to hit that; the
 * clinic-admin role later hit it again from the other side, and the fix
 * now lives in one place: lib/db/rls.ts's appendAuditLog, a bare INSERT
 * via createMany. See DECISIONS.md, 2026-09-06.
 *
 * The try/catch is load-bearing, not tidiness: it must sit INSIDE the
 * decision, so that a failing audit write can never escape into
 * `consumeRateLimit`'s fail-open handler and convert a legitimate block
 * into an allow. Otherwise anyone who could break this insert could
 * switch the limiter off.
 */
async function auditFirstBlock(
  surface: RateLimitSurface,
  ip: string | null,
  count: number,
  now: Date
): Promise<void> {
  try {
    const changes = JSON.stringify({
      surface: surface.name,
      limit: surface.limit,
      windowMinutes: Math.round(surface.windowMs / 60_000),
      count,
    })
    // Bare client on purpose — no session exists yet, and this row's scope
    // columns are NULL by definition. branchId null is what the INSERT
    // policy's first arm admits; the SELECT policy never sees it because
    // appendAuditLog does not RETURN the row.
    await appendAuditLog(prisma, {
      data: {
        id: randomUUID(),
        branchId: null,
        userId: null,
        action: "rate_limit.block",
        entityType: "RateLimit",
        entityId: surface.name,
        changes: JSON.parse(changes),
        ipAddress: ip,
        createdAt: now,
      },
    })
  } catch (err) {
    console.error(`[rate-limit] Failed to audit the "${surface.name}" block; the block itself still stands.`, err)
  }
}

/** The message to show a blocked requester, or null when the request may proceed. */
export function blockedMessage(surface: RateLimitSurface, decision: RateLimitDecision): string | null {
  return decision.allowed ? null : rateLimitMessage(surface, decision.retryAfterMs)
}
