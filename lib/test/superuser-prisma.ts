import { PrismaClient } from "@prisma/client"

/**
 * Test-only escape hatch for fixture teardown. The RLS migration
 * deliberately defines no DELETE policy on Patient/SessionNote/Payment/
 * PayoutResult — §11 is "nothing hard-deletes from the UI," and the
 * cleanest way to keep that true at the database level too is to just not
 * grant DELETE to the app role at all, rather than trust every future
 * query to avoid it. Tests still need to hard-delete their own fixtures
 * between runs, so this connects as the migration superuser (which
 * bypasses RLS) instead of the app's normal APP_DATABASE_URL connection.
 * Import this only from test files.
 */
export const superuserPrisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
})
