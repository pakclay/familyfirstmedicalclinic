import type { PrismaClient } from "@prisma/client"
import { createPrismaClient } from "./client-factory"

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// The running app connects as a non-superuser role (APP_DATABASE_URL) so
// Postgres RLS (§4.2) actually applies — `prisma migrate`/`generate` use
// DATABASE_URL (a superuser, prisma.config.ts) instead, since Postgres
// superusers always bypass RLS regardless of policy. See DECISIONS.md.
const appDatabaseUrl = process.env.APP_DATABASE_URL
if (!appDatabaseUrl && process.env.NODE_ENV !== "test") {
  console.warn(
    "APP_DATABASE_URL is not set — falling back to DATABASE_URL, which means Postgres RLS will NOT be enforced (superuser connections bypass it). Set APP_DATABASE_URL to the non-superuser app role for the RLS backstop to actually apply."
  )
}

/**
 * Serverless + Supabase: the app connection MUST use the pooler in
 * TRANSACTION mode (port 6543), not session mode (port 5432).
 *
 * Every warm Vercel instance holds its own connection pool, and Supabase's
 * pooler in session mode maps each client to a dedicated backend, capped at
 * `pool_size` (15 on the small tiers). A handful of concurrent instances is
 * enough to exhaust that, and the failure is not graceful: a doctor
 * completing a consultation saw
 * "FATAL: (EMAXCONNSESSION) max clients reached in session mode" on
 * 2026-09-06. Transaction mode multiplexes a few hundred clients over those
 * same backends, which is the shape serverless needs.
 *
 * That is safe for this codebase specifically because every piece of
 * session state it relies on is transaction-scoped: lib/db/rls.ts sets its
 * GUCs with `set_config(…, true)` inside an interactive `$transaction`
 * (pinned to one connection until commit), and the queue uses
 * `pg_advisory_xact_lock`. Nothing here assumes two bare-client queries
 * share a session. Keep `connection_limit` on that URL small (a few, not
 * the driver's default of ten) so one instance cannot hog the backends —
 * lib/db/client-factory.ts turns it into the pool's `max`. Migrations
 * (`DATABASE_URL`, build-time only) stay on a direct or session connection:
 * Prisma Migrate needs one.
 *
 * This check cannot fix a wrong URL — it comes from the environment — but
 * it can refuse to be quiet about it. Only the shape is inspected; the
 * value is never logged.
 */
export function warnIfSessionPooler(url: string | undefined): void {
  if (!url) return
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return
  }
  const isSupabasePooler = parsed.hostname.endsWith("pooler.supabase.com")
  if (!isSupabasePooler) return
  if (parsed.port === "5432") {
    console.error(
      "[db] APP_DATABASE_URL points at Supabase's pooler in SESSION mode (port 5432). Every warm instance holds its own connections and the pooler caps session-mode clients at pool_size — expect EMAXCONNSESSION under load. Use TRANSACTION mode: port 6543 with ?connection_limit=<small>. See lib/db/prisma.ts."
    )
  }
}
warnIfSessionPooler(appDatabaseUrl)

// The pool connects lazily, on the first query — so a missing URL surfaces
// there, as it always did, rather than at import time during a build.
export const prisma = globalForPrisma.prisma ?? createPrismaClient(appDatabaseUrl ?? process.env.DATABASE_URL ?? "")

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma
}
