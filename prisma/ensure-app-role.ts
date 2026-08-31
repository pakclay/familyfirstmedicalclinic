import { PrismaClient } from "@prisma/client"

/**
 * Creates and grants the non-superuser role that APP_DATABASE_URL connects
 * as, so Row Level Security actually applies at runtime.
 *
 * This is prisma/grant-app-role.sql expressed as a script, for one reason:
 * that file needs `psql`, and the deploy environment does not have it. A
 * step that can only be run by hand is a step that eventually is not run,
 * and skipping it fails silently — the app starts, every page loads, and
 * branch isolation is simply no longer enforced at the database layer,
 * because Postgres superusers bypass RLS unconditionally.
 *
 * The role name and password are read out of APP_DATABASE_URL rather than
 * from a separate APP_DB_PASSWORD variable. Two places to state the same
 * password is a mismatch waiting to happen, and the mismatch presents as
 * "the app cannot log in to its own database" long after whoever set it is
 * gone. One source, no drift.
 *
 * Idempotent, and safe on every deploy: the role is created only when
 * absent, and the grants are re-applied each time because recreating the
 * schema drops them while leaving the role itself in place.
 */

// Same pattern as lib/test/setup-env.ts: load the env files when they exist,
// and rely on real environment variables when they don't — which is the case
// in CI and on Vercel, where there is no .env on disk.
for (const file of [".env", ".env.local"]) {
  try {
    process.loadEnvFile(file)
  } catch {
    // Absent is normal outside a developer machine.
  }
}

function fail(message: string): never {
  console.error(`ensure-app-role: ${message}`)
  process.exit(1)
}

const superuserUrl = process.env.DATABASE_URL
const appUrl = process.env.APP_DATABASE_URL

if (!superuserUrl) fail("DATABASE_URL is not set — nothing to connect as.")
if (!appUrl) {
  // Not an error worth failing a deploy over: a database with no app role
  // still runs, it just runs without the RLS backstop. Say so loudly rather
  // than either crashing or staying quiet.
  console.warn(
    "ensure-app-role: APP_DATABASE_URL is not set, so no app role was created. " +
      "The app will fall back to DATABASE_URL, which is a superuser and bypasses Row Level Security."
  )
  process.exit(0)
}

const parsed = new URL(appUrl)
// Poolers that front more than one database (e.g. Supabase's Supavisor)
// route by username, encoding it as "<role>.<project-ref>" — the role
// itself is still just "<role>". A bare role name (Neon, plain Postgres)
// has no "." and passes through unchanged.
const role = decodeURIComponent(parsed.username).split(".")[0]
const password = decodeURIComponent(parsed.password)

if (!role) fail("APP_DATABASE_URL has no username, so there is no role to create.")
if (!password) fail("APP_DATABASE_URL has no password. The app role must be able to log in.")

// Role names go into DDL, which cannot be parameterised. Rather than escape
// an identifier and hope, refuse anything that is not a plain identifier —
// there is no legitimate reason for this role to be named otherwise.
if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(role)) {
  fail(`Refusing to use "${role}" as a role name — expected a plain identifier.`)
}

/** Postgres string literal: double every single quote. */
const literal = (value: string) => `'${value.replace(/'/g, "''")}'`

async function main() {
  const prisma = new PrismaClient({ datasources: { db: { url: superuserUrl } } })

  try {
    const existing = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*) AS count FROM pg_catalog.pg_roles WHERE rolname = ${literal(role)}`
    )
    const alreadyThere = Number(existing[0]?.count ?? 0) > 0

    if (!alreadyThere) {
      await prisma.$executeRawUnsafe(`CREATE ROLE ${role} WITH LOGIN`)
    }

    // Set unconditionally: on a redeploy the password in APP_DATABASE_URL may
    // have been rotated, and the role would otherwise keep the old one.
    await prisma.$executeRawUnsafe(`ALTER ROLE ${role} WITH LOGIN PASSWORD ${literal(password)}`)

    // Broad table-level access. RLS narrows SELECT/INSERT/UPDATE per row on
    // the 11 policied tables, and defines no policy at all for some commands
    // (stock_movements has no UPDATE policy — the ledger is append-only), so
    // Postgres denies those regardless of this grant. The tables with no RLS
    // — users, doctors, clinics, holding_companies, branches — are gated by
    // the query layer instead, which is why this grant is their only limit.
    await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${role}`)
    await prisma.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO ${role}`)

    console.log(
      `ensure-app-role: role "${role}" ${alreadyThere ? "already existed" : "created"}; grants applied.`
    )
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error))
})
