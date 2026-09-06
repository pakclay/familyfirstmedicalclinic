import { Prisma } from "@prisma/client"

/**
 * Was this thrown by the database layer rather than by our own code?
 *
 * Server actions return `err.message` to the browser for the errors this
 * codebase throws on purpose — ForbiddenError, InsufficientStockError, a
 * plain `new Error("Queue entry not found")` — because those messages are
 * written for the person on the other end. A Prisma error is not: on
 * 2026-09-06 a doctor completing a consultation was shown
 * "Error querying the database: FATAL: (EMAXCONNSESSION) max clients
 * reached in session mode - max clients are limited to pool_size: 15",
 * verbatim, in the form. That tells a clinician nothing they can act on and
 * tells anyone else which pooler we run and how it is sized. Actions use
 * this to keep the real error in the server log and hand the user
 * `DATABASE_ERROR_MESSAGE` instead.
 *
 * Every Prisma error class is covered, including the initialization and
 * "unknown" ones — the pooler failure above surfaces as one of those, not
 * as a KnownRequestError with a P-code.
 */
export function isDatabaseError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError ||
    err instanceof Prisma.PrismaClientUnknownRequestError ||
    err instanceof Prisma.PrismaClientInitializationError ||
    err instanceof Prisma.PrismaClientRustPanicError ||
    err instanceof Prisma.PrismaClientValidationError
  )
}

/** What a user sees when the database, not the request, is the problem. Honest about which it is. */
export const DATABASE_ERROR_MESSAGE =
  "The database is busy right now and nothing was saved. Wait a moment and try again — if it keeps happening, tell the clinic admin."
