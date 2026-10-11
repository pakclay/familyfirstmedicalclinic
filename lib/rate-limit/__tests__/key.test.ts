import { describe, expect, it } from "vitest"
import {
  UNKNOWN_SOURCE,
  clientIpFromHeaders,
  normalizeIp,
  parseForwardedFor,
  rateLimitKey,
} from "@/lib/rate-limit/key"

/** A stand-in for what `headers()` returns — see `HeaderReader`. */
function headersOf(values: Record<string, string>) {
  const lower = new Map(Object.entries(values).map(([k, v]) => [k.toLowerCase(), v]))
  return { get: (name: string) => lower.get(name.toLowerCase()) ?? null }
}

describe("parseForwardedFor", () => {
  it("returns null for a missing header", () => {
    expect(parseForwardedFor(null)).toBeNull()
  })

  it("returns null for an empty or whitespace-only header", () => {
    expect(parseForwardedFor("")).toBeNull()
    expect(parseForwardedFor("   ")).toBeNull()
    expect(parseForwardedFor(", ,")).toBeNull()
  })

  it("returns the single value when there is only one", () => {
    expect(parseForwardedFor("203.0.113.7")).toBe("203.0.113.7")
    expect(parseForwardedFor("  203.0.113.7  ")).toBe("203.0.113.7")
  })

  it("takes the RIGHTMOST entry of a multi-value list, never the leftmost", () => {
    // This is the whole ballgame. Each hop appends what it observed, so a
    // client that sends its own X-Forwarded-For prepends whatever it likes
    // and the real address ends up last. Taking [0] here would let an
    // attacker pick a fresh key per request and never be limited.
    expect(parseForwardedFor("198.51.100.9, 203.0.113.7")).toBe("203.0.113.7")
    expect(parseForwardedFor("1.1.1.1, 2.2.2.2, 203.0.113.7")).toBe("203.0.113.7")
    expect(parseForwardedFor("198.51.100.9,203.0.113.7")).toBe("203.0.113.7")
  })

  it("does not fall back leftward when the rightmost entry is not an address", () => {
    // Falling back is the step that starts trusting client-supplied values.
    expect(parseForwardedFor("203.0.113.7, unknown")).toBeNull()
    expect(parseForwardedFor("203.0.113.7, <script>alert(1)</script>")).toBeNull()
  })
})

describe("normalizeIp", () => {
  it("strips a port from an IPv4 address", () => {
    expect(normalizeIp("203.0.113.7:54321")).toBe("203.0.113.7")
  })

  it("unwraps a bracketed IPv6 address, with or without a port", () => {
    expect(normalizeIp("[2001:db8::1]:443")).toBe("2001:db8::1")
    expect(normalizeIp("[2001:db8::1]")).toBe("2001:db8::1")
  })

  it("keeps a bare IPv6 address intact rather than mistaking a colon for a port", () => {
    expect(normalizeIp("2001:db8::1")).toBe("2001:db8::1")
    expect(normalizeIp("::1")).toBe("::1")
  })

  it("lowercases so one source cannot occupy two keys", () => {
    expect(normalizeIp("2001:DB8::AB")).toBe("2001:db8::ab")
  })

  it("drops an IPv6 zone id, which is not part of the address", () => {
    expect(normalizeIp("fe80::1%eth0")).toBe("fe80::1")
  })

  it("rejects values that are not plausibly addresses", () => {
    expect(normalizeIp("")).toBeNull()
    expect(normalizeIp("   ")).toBeNull()
    expect(normalizeIp("unknown")).toBeNull()
    expect(normalizeIp("evil.example.com")).toBeNull()
    expect(normalizeIp("203.0.113.7; DROP TABLE rate_limits")).toBeNull()
    expect(normalizeIp("1".repeat(200))).toBeNull()
  })
})

describe("clientIpFromHeaders", () => {
  it("returns null when no source header is present at all", () => {
    // Local `next dev` sits behind no proxy. Callers turn this into the
    // shared UNKNOWN_SOURCE bucket — deliberately not a skipped check.
    expect(clientIpFromHeaders(headersOf({}))).toBeNull()
  })

  describe("on Vercel", () => {
    it("prefers the platform-set x-vercel-forwarded-for over the others", () => {
      const ip = clientIpFromHeaders(
        headersOf({
          "x-forwarded-for": "198.51.100.9",
          "x-real-ip": "198.51.100.8",
          "x-vercel-forwarded-for": "203.0.113.7",
        }),
        true
      )
      expect(ip).toBe("203.0.113.7")
    })

    it("falls back to x-real-ip before the generic x-forwarded-for", () => {
      const ip = clientIpFromHeaders(headersOf({ "x-forwarded-for": "198.51.100.9", "x-real-ip": "203.0.113.7" }), true)
      expect(ip).toBe("203.0.113.7")
    })

    it("falls back to the rightmost x-forwarded-for entry when nothing better exists", () => {
      const ip = clientIpFromHeaders(headersOf({ "x-forwarded-for": "198.51.100.9, 203.0.113.7" }), true)
      expect(ip).toBe("203.0.113.7")
    })

    it("skips a header that is present but unusable rather than giving up", () => {
      const ip = clientIpFromHeaders(
        headersOf({ "x-vercel-forwarded-for": "unknown", "x-real-ip": "203.0.113.7" }),
        true
      )
      expect(ip).toBe("203.0.113.7")
    })
  })

  describe("off Vercel (Cloud Run)", () => {
    it("ignores client-sent x-vercel-forwarded-for and x-real-ip, which nothing overwrites there", () => {
      // An attacker rotating these per request must not get a fresh budget
      // each time; only the address Google appended counts.
      const ip = clientIpFromHeaders(
        headersOf({
          "x-vercel-forwarded-for": "198.51.100.1",
          "x-real-ip": "198.51.100.2",
          "x-forwarded-for": "198.51.100.3, 203.0.113.7",
        }),
        false
      )
      expect(ip).toBe("203.0.113.7")
    })

    it("returns null rather than trusting a spoofable header when x-forwarded-for is absent", () => {
      expect(clientIpFromHeaders(headersOf({ "x-real-ip": "203.0.113.7" }), false)).toBeNull()
    })
  })
})

describe("rateLimitKey", () => {
  it("namespaces by surface so the two surfaces have independent budgets", () => {
    expect(rateLimitKey("login", "203.0.113.7")).toBe("login:203.0.113.7")
    expect(rateLimitKey("booking", "203.0.113.7")).toBe("booking:203.0.113.7")
    expect(rateLimitKey("login", "203.0.113.7")).not.toBe(rateLimitKey("booking", "203.0.113.7"))
  })

  it("puts address-less requests in a shared per-surface bucket, not a free pass", () => {
    expect(rateLimitKey("login", null)).toBe(`login:${UNKNOWN_SOURCE}`)
  })
})
