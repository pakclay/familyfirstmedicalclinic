/**
 * The tunable numbers for per-IP rate limiting, in one place — the same
 * shape as `LOGIN_LOCKOUT_THRESHOLD` / `LOGIN_LOCKOUT_DURATION_MINUTES` in
 * lib/queries/users.ts, and for the same reason: these are the values a
 * reviewer argues about, so they should not be buried in the code that
 * applies them.
 *
 * ── This is a *different* control from the per-account lockout ─────────
 * lib/queries/users.ts locks one ACCOUNT after 5 consecutive failed
 * passwords, which stops a brute-force pass against a known email. This
 * file limits one SOURCE, which stops the attacks the account lockout
 * can't see: a spray of one or two guesses each across hundreds of
 * accounts (no single account ever reaches 5), and a flood of anonymous
 * bookings. The two run side by side and neither replaces the other.
 */

/**
 * One rate-limited surface. `name` is part of the counter's primary key,
 * so changing it silently resets everyone's budget — treat it as stable.
 */
export type RateLimitSurface = {
  readonly name: string
  /** Requests allowed from one source per window. The (limit + 1)-th is refused. */
  readonly limit: number
  readonly windowMs: number
  /** Plural noun phrase for the message shown to a blocked requester. */
  readonly subject: string
}

/**
 * 30 attempts / 15 minutes for login.
 *
 * Sized for a shared source, not a single person: a clinic front desk sits
 * behind one NAT, so every staff member signing in at the start of a shift
 * looks like the same IP. The per-account lockout already caps any one
 * account at 5 attempts, so 30 leaves room for roughly six people on one
 * public address to each fumble their password all the way to their own
 * account lockout inside the same window — comfortably past a realistic
 * bad morning — while still cutting a password-spray from "unbounded" to
 * 30 accounts probed per source per window.
 *
 * The window matches `LOGIN_LOCKOUT_DURATION_MINUTES` deliberately: both
 * controls then clear on the same clock, so whoever is on the phone to a
 * locked-out clinic has one number to quote, not two.
 */
export const LOGIN_RATE_LIMIT_THRESHOLD = 30
export const LOGIN_RATE_LIMIT_WINDOW_MINUTES = 15

/**
 * 10 attempts / 15 minutes for public booking.
 *
 * Tighter than login because the surface is anonymous public internet with
 * no account behind it, and every accepted request creates real rows (a
 * patient, a queue entry, a notification) in a clinic's working queue.
 *
 * 10 rather than 3-5 because *every* submission counts, including ones
 * rejected by validation — the limiter runs before the write, so a parent
 * booking for three children from one phone and mistyping a birthdate
 * twice along the way is already at 8. Below 10 that person is turned away
 * from a real clinic; at 10 a script is still stopped from filling a
 * day's queue with fabricated patients.
 *
 * Known limitation: a large NAT (a public wifi, a barangay hall, a
 * university) shares one address, so a genuine burst of unrelated bookings
 * from one place can trip this. That is the cost of having no account to
 * key on, and it is why the block message is explicit about being about
 * the network rather than the person.
 */
export const BOOKING_RATE_LIMIT_THRESHOLD = 10
export const BOOKING_RATE_LIMIT_WINDOW_MINUTES = 15

export const LOGIN_RATE_LIMIT: RateLimitSurface = {
  name: "login",
  limit: LOGIN_RATE_LIMIT_THRESHOLD,
  windowMs: LOGIN_RATE_LIMIT_WINDOW_MINUTES * 60_000,
  subject: "sign-in attempts",
}

export const BOOKING_RATE_LIMIT: RateLimitSurface = {
  name: "booking",
  limit: BOOKING_RATE_LIMIT_THRESHOLD,
  windowMs: BOOKING_RATE_LIMIT_WINDOW_MINUTES * 60_000,
  subject: "booking requests",
}

/**
 * How long a counter row survives after its last hit before the retention
 * job removes it. Not a retention *policy* in the compliance sense (this
 * is operational state, not a record) — the row stops mattering the moment
 * its window closes, and the longest window here is 15 minutes. A day is
 * simply long enough that yesterday's counters are still there if someone
 * is investigating an incident this morning.
 *
 * Lives here rather than in lib/retention/policy.ts so the window and its
 * cleanup horizon can be read side by side; lib/retention/policy.ts
 * re-exports it as part of that job's public surface.
 */
export const RATE_LIMIT_RETENTION_DAYS = 1

/**
 * What a blocked requester is told.
 *
 * ── Why this is explicit where the account lockout is deliberately not ──
 * The per-account lockout shows the same generic "Incorrect email or
 * password" whatever the cause, because saying "this account is locked"
 * confirms the account *exists* — an enumeration oracle an attacker gets
 * for free just by guessing emails.
 *
 * A per-IP block leaks nothing of the kind. It is a statement about the
 * requester's own network, made to the requester, and it is true whether
 * or not the email they typed corresponds to any account at all — an
 * attacker learns only that they themselves have been making a lot of
 * requests, which they already knew. So the reasoning behind the generic
 * message does not carry over here, and being explicit is strictly better:
 * a real front desk that hits this needs to know it is a temporary
 * throttle and roughly how long, or they will spend the morning retyping a
 * password that was correct all along.
 */
export function rateLimitMessage(surface: RateLimitSurface, retryAfterMs: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterMs / 60_000))
  const unit = minutes === 1 ? "minute" : "minutes"
  return `Too many ${surface.subject} from this network. Please try again in about ${minutes} ${unit}.`
}
