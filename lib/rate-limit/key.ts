/**
 * Deriving the rate-limit key (the client's source address) from request
 * headers. Deliberately pure and free of `next/headers` — the caller reads
 * `headers()` inside the server action and hands the result here, so every
 * branch below is unit-testable without a request, a server, or a database.
 *
 * ── This is the part that decides whether the whole feature is real ─────
 * If the address comes from a header the *client* controls, an attacker
 * rotates it once per request and is never limited — the counters fill up
 * with one row per fabricated address and nothing is ever blocked. So the
 * only question that matters is which header this deployment's proxy
 * actually guarantees.
 *
 * `NextRequest.ip` is not an option: it was removed in Next.js 15 (see
 * node_modules/next/dist/docs/01-app/02-guides/upgrading/version-15.md —
 * "The `geo` and `ip` properties on `NextRequest` have been removed as
 * these values are provided by your hosting provider"), and this app is on
 * Next.js 16. Vercel's replacement is `ipAddress()` from
 * `@vercel/functions`, which is a new dependency this change is not
 * allowed to add — and all that function does is read the same headers
 * below, so reading them directly loses nothing.
 *
 * Precedence, most trustworthy first:
 *
 *  1. `x-vercel-forwarded-for` — set by Vercel's edge network on every
 *     request to a Vercel deployment, from the TCP peer address it
 *     actually observed. It is in Vercel's own `x-vercel-*` namespace,
 *     which the platform overwrites on ingress, so a client that sends its
 *     own copy has it replaced rather than honoured. This is the header to
 *     trust on the target deployment.
 *  2. `x-real-ip` — also set by Vercel (and by most reverse proxies) to a
 *     single observed client address. Same guarantee, less specific name.
 *  3. `x-forwarded-for` — the generic fallback, and the only one of the
 *     three that is *client-supplied in the general case*. See the
 *     rightmost-entry rule on `parseForwardedFor` below.
 *
 * ── This control is only as strong as the deployment in front of it ────
 * Every guarantee above comes from the proxy, not from this code. If the
 * app is ever reachable directly — an origin exposed alongside the CDN, a
 * misconfigured custom host, a self-hosted `next start` on a bare port —
 * then any client can set all three of these headers to whatever it likes,
 * and per-IP limiting degrades to per-*claimed*-IP limiting, which stops
 * nobody. Keeping the origin reachable only through the platform proxy is
 * a deployment requirement of this feature, not a nice-to-have.
 */

/**
 * The slice of the Web `Headers` interface this module needs. Typing the
 * parameter this way (rather than as `Headers`) is what keeps the tests
 * from having to construct a request.
 */
export type HeaderReader = { get(name: string): string | null }

/** Longest possible textual IPv6 address (`…%` zone ids are stripped first). */
const MAX_IP_LENGTH = 45

/** Post-normalisation charset: dotted-quad IPv4 or lowercase hex IPv6. */
const IP_SHAPE = /^[0-9a-f.:]+$/

/**
 * Headers to consult, in descending order of trustworthiness. See the
 * module comment — order matters, and the first one that yields a usable
 * address wins.
 */
const SOURCE_HEADERS = ["x-vercel-forwarded-for", "x-real-ip", "x-forwarded-for"] as const

/**
 * The key used when no trustworthy address could be derived. See
 * `clientIpFromHeaders` for what that means and why this is a shared
 * bucket rather than a free pass.
 */
export const UNKNOWN_SOURCE = "unknown"

/**
 * Tidies one address into the exact string that becomes part of a primary
 * key, and rejects anything that isn't plausibly an address at all.
 * Returns `null` rather than a best guess — a value that doesn't parse
 * means the hop that wrote it isn't behaving like a proxy, and inventing a
 * key from garbage would just create rows nothing ever matches again.
 */
export function normalizeIp(raw: string): string | null {
  let value = raw.trim().toLowerCase()
  if (!value) return null

  const bracketed = /^\[([^\]]+)](?::\d+)?$/.exec(value)
  if (bracketed) {
    // "[2001:db8::1]:443" or "[2001:db8::1]" — bracketed IPv6, port optional.
    value = bracketed[1]
  } else if (value.includes(".") && value.split(":").length === 2) {
    // "203.0.113.7:54321" — IPv4 with a port. A bare IPv6 address is full
    // of colons too, so only strip when there is exactly one colon *and*
    // the part in front of it is dotted-quad shaped.
    value = value.slice(0, value.indexOf(":"))
  }

  // Link-local zone id ("fe80::1%eth0") isn't part of the address, and
  // would otherwise split one source across several keys.
  const zone = value.indexOf("%")
  if (zone !== -1) value = value.slice(0, zone)

  if (!value || value.length > MAX_IP_LENGTH || !IP_SHAPE.test(value)) return null
  return value
}

/**
 * Picks the real client out of a comma-separated forwarding list.
 *
 * `X-Forwarded-For` reads left-to-right as `client, proxy1, proxy2`, and
 * the *leftmost* entry is the obvious-looking choice — and the wrong one.
 * Each hop **appends** the address it observed, so a client that sends
 * `X-Forwarded-For: 1.2.3.4` before it ever reaches the proxy produces
 * `1.2.3.4, <real client address>` by the time the app sees it. Every
 * entry except the last was therefore written by something upstream of the
 * trusted proxy — i.e. potentially by the attacker — and only the
 * **rightmost** entry is the address a trusted hop actually observed.
 * Taking the leftmost is the single most common way a per-IP limiter ends
 * up doing nothing at all.
 *
 * If the rightmost entry doesn't parse as an address, this returns `null`
 * rather than walking further left: falling back leftward is exactly the
 * step that starts trusting client-supplied values.
 *
 * Caveat for a future deployment change: "rightmost" is correct for
 * *one* trusted hop. Behind two (a CDN in front of Vercel, say) the
 * rightmost entry is the inner proxy's own address, and every visitor
 * would collapse into one key. Adding a second hop means revisiting this
 * function, not just the DNS.
 */
export function parseForwardedFor(value: string | null): string | null {
  if (!value) return null
  const entries = value.split(",").filter((entry) => entry.trim() !== "")
  if (entries.length === 0) return null
  return normalizeIp(entries[entries.length - 1])
}

/**
 * The client address to rate-limit by, or `null` when none of the trusted
 * headers yielded one.
 *
 * `null` happens in local development (`next dev` sits behind no proxy, so
 * none of these headers exist), and in production only if the deployment
 * is misconfigured or the origin is being reached directly. Callers turn
 * it into the shared `UNKNOWN_SOURCE` bucket — see `rateLimitKey`.
 */
export function clientIpFromHeaders(headers: HeaderReader): string | null {
  for (const name of SOURCE_HEADERS) {
    const ip = parseForwardedFor(headers.get(name))
    if (ip) return ip
  }
  return null
}

/**
 * The primary key of the counter row: one surface, one source.
 *
 * Scoped by surface but *not* by anything else the caller controls — the
 * booking key deliberately does not include the clinic slug, or an
 * attacker would multiply their budget by the number of clinics simply by
 * rotating the URL.
 *
 * ── What happens with no usable address (a deliberate choice) ──────────
 * Requests with no derivable source share one bucket per surface
 * (`"login:unknown"`). Both alternatives are worse:
 *
 *  - *Skipping the limit* would mean an attacker who can reach the origin
 *    without passing through the proxy — precisely the position a serious
 *    attacker works to reach — turns the control off by sending no headers
 *    at all. A security control with a "please don't limit me" opt-in is
 *    not a control.
 *  - *Failing the request outright* would take the app down entirely the
 *    first time a proxy stopped setting a header, and would make local
 *    development impossible.
 *
 * A shared bucket does mean one noisy source can spend the budget for
 * every other header-less request, so `consumeRateLimit` logs a warning
 * the first time it is used in production. That is the honest trade: in a
 * correctly-configured deployment this key is unreachable, and when it
 * *is* reached the fix is the proxy configuration — not a larger bucket,
 * which only makes the same exhaustion take longer.
 */
export function rateLimitKey(surface: string, ip: string | null): string {
  return `${surface}:${ip ?? UNKNOWN_SOURCE}`
}
