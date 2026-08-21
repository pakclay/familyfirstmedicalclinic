import type { Prisma } from "@prisma/client"
import { toZonedTime } from "date-fns-tz"

/**
 * Allocates the next queue number for a clinic/day inside an existing
 * transaction. §7.1: "queue_number resets daily per clinic. Generate it
 * inside a transaction so two simultaneous bookings can't collide."
 *
 * A plain `max(queueNumber) + 1` read-then-write inside a transaction isn't
 * actually safe under Postgres's default READ COMMITTED isolation — two
 * concurrent transactions can both read the same max before either commits
 * and then both try to insert the same number, colliding against the
 * `@@unique([clinicId, queueDate, queueNumber])` constraint. A
 * transaction-scoped advisory lock keyed on clinic+day serializes number
 * allocation for that key without taking a table-level lock or needing a
 * retry loop: the second transaction simply blocks here until the first
 * commits (releasing the lock automatically at commit/rollback).
 */
export async function nextQueueNumber(
  tx: Prisma.TransactionClient,
  clinicId: string,
  queueDate: Date
): Promise<number> {
  const dayKey = queueDate.toISOString().slice(0, 10)
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${clinicId + dayKey}))`

  const last = await tx.queueEntry.aggregate({
    where: { clinicId, queueDate },
    _max: { queueNumber: true },
  })
  return (last._max.queueNumber ?? 0) + 1
}

/**
 * Midnight UTC representing "today" in the *clinic's own* calendar day
 * (stored as a plain `@db.Date`) — not the server's or host machine's.
 * Manila is UTC+8, so naively using the server's UTC calendar date would
 * be a whole day behind for the 16:00–23:59 UTC window every day (already
 * tomorrow in Manila). `toZonedTime` shifts the instant so its **UTC**
 * getters read as the target zone's wall-clock time; reading it with plain
 * (non-UTC) getters would silently depend on the host machine's own
 * timezone matching — the exact bug this repo's history already caught
 * once in the availability engine (see DECISIONS.md, prior project).
 */
export function todayAsQueueDate(timezone: string): Date {
  const zoned = toZonedTime(new Date(), timezone)
  return new Date(Date.UTC(zoned.getUTCFullYear(), zoned.getUTCMonth(), zoned.getUTCDate()))
}
