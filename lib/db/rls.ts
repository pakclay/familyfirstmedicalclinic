import type { Prisma } from "@prisma/client"
import { prisma } from "./prisma"
import type { AbilitySubject } from "@/lib/permissions/ability"

/**
 * Runs `fn` inside a Postgres transaction with the RLS session GUCs
 * (app.role / app.user_id / app.clinic_id) set via SET LOCAL, so the
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
    await tx.$executeRaw`SELECT set_config('app.clinic_id', ${user.clinicId ?? ""}, true)`
    return fn(tx)
  })
}

/**
 * Same RLS-scoping mechanism as `runWithRls`, for the handful of routes
 * with no authenticated user at all: public booking (§7.1), the public
 * display screen, and the patient status page (§4: "Patients never
 * authenticate"). Every clinic-scoped RLS policy's condition is
 * `clinic_id = app.clinic_id OR app.role = 'HOLDING_ADMIN'` — the role GUC
 * only matters for that second branch, so a public caller just needs
 * `app.clinic_id` set to the target clinic and any role string that isn't
 * `'HOLDING_ADMIN'` to hit the first branch on its own merits.
 */
export async function runWithClinicScope<T>(
  clinicId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.role', 'PUBLIC', true)`
    await tx.$executeRaw`SELECT set_config('app.user_id', '', true)`
    await tx.$executeRaw`SELECT set_config('app.clinic_id', ${clinicId}, true)`
    return fn(tx)
  })
}

/**
 * Full cross-clinic visibility — used *only* for looking up a queue entry
 * by its access token (§7.3 `/q/{access_token}`). Token possession *is*
 * the authorization there (§10: cryptographically random, single-purpose,
 * unguessable), so there's no clinic to scope RLS by until after the row
 * is already found — the lookup has to see across all clinics to find it
 * at all. Only ever call this for a single `findUnique`/`findFirst` keyed
 * by the unguessable token itself; never for a list or any query whose
 * `where` a caller could otherwise influence.
 */
export async function runWithFullVisibility<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.role', 'HOLDING_ADMIN', true)`
    await tx.$executeRaw`SELECT set_config('app.user_id', '', true)`
    await tx.$executeRaw`SELECT set_config('app.clinic_id', '', true)`
    return fn(tx)
  })
}
