import { PrismaClient } from "@prisma/client"

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// The running app connects as a non-superuser role (APP_DATABASE_URL) so
// Postgres RLS (§4.2) actually applies — `prisma migrate`/`generate` use
// DATABASE_URL (a superuser) instead, since Postgres superusers always
// bypass RLS regardless of policy. See DECISIONS.md.
const appDatabaseUrl = process.env.APP_DATABASE_URL
if (!appDatabaseUrl && process.env.NODE_ENV !== "test") {
  console.warn(
    "APP_DATABASE_URL is not set — falling back to DATABASE_URL, which means Postgres RLS will NOT be enforced (superuser connections bypass it). Set APP_DATABASE_URL to the non-superuser app role for the RLS backstop to actually apply."
  )
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient(appDatabaseUrl ? { datasources: { db: { url: appDatabaseUrl } } } : undefined)

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma
}
