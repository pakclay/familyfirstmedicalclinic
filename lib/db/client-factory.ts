import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

/**
 * Every PrismaClient in this codebase — the app's (lib/db/prisma.ts), the
 * tests' superuser one, and the three scripts under prisma/ — is built here.
 * Since Prisma 7 the client cannot open a connection by itself: it needs a
 * driver adapter, and this one wraps node-postgres (`pg`). Three things the
 * old Rust engine read off the connection string are now this file's job:
 *
 * - `connection_limit` — how many connections one process may hold. The
 *   engine honoured it; `pg` does not know it, so it becomes the pool's
 *   `max`. Serverless wants it small (lib/db/prisma.ts). When the URL is
 *   silent the engine still capped it; `pg` does not, so DEFAULT_POOL_MAX
 *   below stands in — see its comment for the outage that needed it.
 * - `pool_timeout` — how long a caller waits for a free connection. The
 *   engine gave up after 10s; `pg` waits forever by default, which in a
 *   serverless function means burning the whole invocation budget on a
 *   queue instead of failing with something a log can explain.
 * - `pgbouncer=true` — obsolete. It told the engine not to expect a prepared
 *   statement to outlive its transaction. The adapter never names its
 *   statements unless asked (`statementNameGenerator`), so nothing here
 *   assumes one survives, and the flag is ignored if present.
 * - TLS. The engine's default was `sslmode=prefer`: encrypt when the server
 *   offers it, without verifying the certificate. `pg`'s default is no TLS
 *   at all, which would silently put production traffic between Vercel and
 *   Supabase on the wire in the clear. So a remote host gets TLS with the
 *   same (un)verification the engine applied, a local one gets none, and a
 *   URL that states its own `sslmode` is left to mean what it says —
 *   `sslmode=verify-full&sslrootcert=…` is how to get verification.
 */

/**
 * What one process may hold when the URL doesn't say.
 *
 * `pg` defaults to 10. The old Rust engine defaulted to
 * `num_physical_cpus * 2 + 1`, which on a 2-vCPU Vercel function is about
 * 5 — so moving to the driver adapter silently doubled what a single
 * instance would grab, and nothing in the schema or the URL said so.
 *
 * That mattered because production runs against Supabase's pooler in
 * SESSION mode, which admits `pool_size` (15 on the small tiers) clients
 * across *every* warm instance. /console/admin issues ten independent
 * reads at once, so one render of it alone asked for ten of those fifteen
 * slots and a second concurrent render could not be served — the page
 * failed with the generic error card while lighter pages beside it kept
 * working. Measured: ten connections for a single render before this cap.
 *
 * Five restores the engine's own order of magnitude, matches the
 * `connection_limit=5` that .env.example already recommends, and leaves a
 * fan-out larger than the pool queueing (two quick waves) rather than
 * failing. It reduces the blast radius; it is not the whole fix — session
 * mode is still the wrong mode, and lib/db/prisma.ts says so at startup.
 */
export const DEFAULT_POOL_MAX = 5

/**
 * The engine's `pool_timeout` was 10 seconds. `pg` waits forever, so a
 * saturated pool would hang a request until the platform killed it, with
 * nothing in the log naming the cause. Ten seconds reproduces the old
 * behaviour: a clear error, in time for the action layer to turn it into
 * "the database is busy and nothing was saved" (lib/db/errors.ts).
 */
export const CONNECTION_TIMEOUT_MS = 10_000

/** What the URL asks for, or undefined when it says nothing (or nonsense). */
export function poolMaxFromUrl(url: string): number | undefined {
  let raw: string | null
  try {
    raw = new URL(url).searchParams.get("connection_limit")
  } catch {
    return undefined
  }
  if (raw === null) return undefined
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : undefined
}

/** The cap actually applied: the URL's `connection_limit`, else the default. */
export function poolMaxFor(url: string): number {
  return poolMaxFromUrl(url) ?? DEFAULT_POOL_MAX
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

export function sslFromUrl(url: string): { rejectUnauthorized: false } | undefined {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }
  if (parsed.searchParams.has("sslmode")) return undefined
  if (LOCAL_HOSTS.has(parsed.hostname)) return undefined
  return { rejectUnauthorized: false }
}

export function createPrismaClient(connectionString: string): PrismaClient {
  // `ssl` is added only when it has a value: `pg` merges an explicit config
  // over the parsed connection string, and an explicit `undefined` would win
  // over — and erase — what the URL said. `max` and the timeout are always
  // set, because "unset" is exactly the default this file exists to correct.
  const ssl = sslFromUrl(connectionString)
  const adapter = new PrismaPg({
    connectionString,
    max: poolMaxFor(connectionString),
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    ...(ssl !== undefined ? { ssl } : {}),
  })
  return new PrismaClient({ adapter })
}
