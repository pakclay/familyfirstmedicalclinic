import type { Prisma } from "@prisma/client"
import { prisma } from "./prisma"
import type { AbilitySubject } from "@/lib/permissions/ability"

/**
 * Runs `fn` inside a Postgres transaction with the RLS session GUCs
 * (app.role / app.user_id / app.branch_id) set via SET LOCAL, so the
 * policies in the enable_rls_backstop migration can see who's asking.
 * SET LOCAL is transaction-scoped and never leaks across pooled
 * connections — safe under Prisma's connection pooling.
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
    await tx.$executeRaw`SELECT set_config('app.role', ${user.role}, true)`
    await tx.$executeRaw`SELECT set_config('app.user_id', ${user.id}, true)`
    await tx.$executeRaw`SELECT set_config('app.branch_id', ${user.homeBranchId ?? ""}, true)`
    return fn(tx)
  })
}
