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
 *   `max`. Serverless wants it small (lib/db/prisma.ts).
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
  // Keys are added only when they have a value: `pg` merges an explicit
  // config over the parsed connection string, and an explicit `undefined`
  // would win over — and erase — what the URL said.
  const max = poolMaxFromUrl(connectionString)
  const ssl = sslFromUrl(connectionString)
  const adapter = new PrismaPg({
    connectionString,
    ...(max !== undefined ? { max } : {}),
    ...(ssl !== undefined ? { ssl } : {}),
  })
  return new PrismaClient({ adapter })
}
