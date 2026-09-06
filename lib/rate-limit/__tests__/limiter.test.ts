import { afterAll, describe, expect, it } from "vitest"
import { superuserPrisma } from "@/lib/test/superuser-prisma"
import { prisma } from "@/lib/db/prisma"
import { consumeRateLimit } from "@/lib/rate-limit/limiter"
import { rateLimitKey, UNKNOWN_SOURCE } from "@/lib/rate-limit/key"
import {
  BOOKING_RATE_LIMIT,
  BOOKING_RATE_LIMIT_THRESHOLD,
  LOGIN_RATE_LIMIT,
  LOGIN_RATE_LIMIT_THRESHOLD,
} from "@/lib/rate-limit/policy"

/**
 * Every assertion here names the exact count/key/row it expects rather
 * than checking that "something happened" — same standard as
 * lib/queries/__tests__/audit-log.test.ts, and for a closely related
 * reason. A rate limiter that silently allows everything looks *identical*
 * to a healthy one from the caller's side unless the test pins the numbers
 * down: `expect(decision.allowed).toBe(true)` passes just as happily
 * against a `consume` that was replaced with `return { allowed: true }`.
 * So the blocked cases are asserted explicitly, the counts are asserted
 * exactly, and the counter row is read back out of the database.
 */

const usedIps: string[] = []

/**
 * A fresh source per test, so a re-run (or a parallel worker) never
 * inherits another run's counter. Documentation-range prefixes would only
 * give 254 addresses; RFC 1918 space gives plenty.
 */
function testIp(): string {
  const octet = () => Math.floor(Math.random() * 254) + 1
  const ip = `10.${octet()}.${octet()}.${octet()}`
  usedIps.push(ip)
  return ip
}

afterAll(async () => {
  const keys = usedIps.flatMap((ip) => [rateLimitKey("login", ip), rateLimitKey("booking", ip)])
  // Plus the shared address-less bucket, which the fallback test writes to.
  keys.push(rateLimitKey("login", null))
  await superuserPrisma.rateLimit.deleteMany({ where: { key: { in: keys } } })
  await superuserPrisma.auditLog.deleteMany({ where: { action: "rate_limit.block", ipAddress: { in: usedIps } } })
  await superuserPrisma.$disconnect()
  await prisma.$disconnect()
})

describe("consumeRateLimit", () => {
  it("allows exactly the configured number of booking attempts, then blocks", async () => {
    const ip = testIp()
    const now = new Date()

    for (let attempt = 1; attempt <= BOOKING_RATE_LIMIT_THRESHOLD; attempt++) {
      const decision = await consumeRateLimit(BOOKING_RATE_LIMIT, ip, now)
      expect(decision.count).toBe(attempt)
      expect(decision.allowed).toBe(true)
      expect(decision.degraded).toBe(false)
    }

    const first = await consumeRateLimit(BOOKING_RATE_LIMIT, ip, now)
    expect(first.count).toBe(BOOKING_RATE_LIMIT_THRESHOLD + 1)
    expect(first.allowed).toBe(false)
    expect(first.firstBlock).toBe(true)

    const second = await consumeRateLimit(BOOKING_RATE_LIMIT, ip, now)
    expect(second.count).toBe(BOOKING_RATE_LIMIT_THRESHOLD + 2)
    expect(second.allowed).toBe(false)
    // Only the crossing itself is a "first block" — this is what bounds
    // the audit writes.
    expect(second.firstBlock).toBe(false)
  })

  it("allows exactly the configured number of login attempts, then blocks", async () => {
    const ip = testIp()
    const now = new Date()

    for (let attempt = 1; attempt <= LOGIN_RATE_LIMIT_THRESHOLD; attempt++) {
      const decision = await consumeRateLimit(LOGIN_RATE_LIMIT, ip, now)
      expect(decision.allowed).toBe(true)
    }

    const blocked = await consumeRateLimit(LOGIN_RATE_LIMIT, ip, now)
    expect(blocked.allowed).toBe(false)
    expect(blocked.count).toBe(LOGIN_RATE_LIMIT_THRESHOLD + 1)
    expect(blocked.retryAfterMs).toBeGreaterThan(0)
  })

  it("resets the count when the window rolls, and blocks again within the new one", async () => {
    const ip = testIp()
    const start = new Date()

    for (let attempt = 1; attempt <= BOOKING_RATE_LIMIT_THRESHOLD + 1; attempt++) {
      await consumeRateLimit(BOOKING_RATE_LIMIT, ip, start)
    }
    const stillBlocked = await consumeRateLimit(BOOKING_RATE_LIMIT, ip, start)
    expect(stillBlocked.allowed).toBe(false)

    // One millisecond before the window closes, the block still stands...
    const justBefore = new Date(start.getTime() + BOOKING_RATE_LIMIT.windowMs - 1)
    expect((await consumeRateLimit(BOOKING_RATE_LIMIT, ip, justBefore)).allowed).toBe(false)

    // ...and once past it the counter restarts at 1 rather than carrying over.
    const after = new Date(start.getTime() + BOOKING_RATE_LIMIT.windowMs + 1_000)
    const rolled = await consumeRateLimit(BOOKING_RATE_LIMIT, ip, after)
    expect(rolled.allowed).toBe(true)
    expect(rolled.count).toBe(1)

    // The new window is a full window long, not the remainder of the old one.
    const row = await superuserPrisma.rateLimit.findUnique({ where: { key: rateLimitKey("booking", ip) } })
    expect(row?.count).toBe(1)
    expect(row?.windowStart.getTime()).toBe(after.getTime())

    // And the fresh budget is a whole budget, not a leftover of the old one.
    for (let attempt = 2; attempt <= BOOKING_RATE_LIMIT_THRESHOLD; attempt++) {
      expect((await consumeRateLimit(BOOKING_RATE_LIMIT, ip, after)).allowed).toBe(true)
    }
    expect((await consumeRateLimit(BOOKING_RATE_LIMIT, ip, after)).allowed).toBe(false)
  })

  it("gives two different source addresses independent budgets", async () => {
    const noisy = testIp()
    const innocent = testIp()
    const now = new Date()

    for (let attempt = 1; attempt <= BOOKING_RATE_LIMIT_THRESHOLD + 1; attempt++) {
      await consumeRateLimit(BOOKING_RATE_LIMIT, noisy, now)
    }
    expect((await consumeRateLimit(BOOKING_RATE_LIMIT, noisy, now)).allowed).toBe(false)

    // The second address must be untouched — not merely "allowed", but on
    // its very first attempt.
    const other = await consumeRateLimit(BOOKING_RATE_LIMIT, innocent, now)
    expect(other.allowed).toBe(true)
    expect(other.count).toBe(1)
    expect(other.key).toBe(rateLimitKey("booking", innocent))
  })

  it("keeps the two surfaces on separate budgets for the same address", async () => {
    const ip = testIp()
    const now = new Date()

    for (let attempt = 1; attempt <= BOOKING_RATE_LIMIT_THRESHOLD + 1; attempt++) {
      await consumeRateLimit(BOOKING_RATE_LIMIT, ip, now)
    }
    expect((await consumeRateLimit(BOOKING_RATE_LIMIT, ip, now)).allowed).toBe(false)

    // Spending the booking budget must not lock the same network out of
    // signing in — that would let one abusive visitor on a clinic's wifi
    // take the front desk offline.
    const login = await consumeRateLimit(LOGIN_RATE_LIMIT, ip, now)
    expect(login.allowed).toBe(true)
    expect(login.count).toBe(1)
  })

  it("keeps the counter in the database, not in process memory", async () => {
    const ip = testIp()
    const key = rateLimitKey("booking", ip)
    const now = new Date()

    // Seed the counter directly, standing in for attempts recorded by a
    // *different* process — a second Vercel instance, or this one before a
    // restart. An in-process Map would know nothing about this row, so a
    // limiter backed by one would happily allow the next request.
    await superuserPrisma.rateLimit.create({
      data: { key, count: BOOKING_RATE_LIMIT_THRESHOLD, windowStart: now, updatedAt: now },
    })

    const decision = await consumeRateLimit(BOOKING_RATE_LIMIT, ip, now)
    expect(decision.count).toBe(BOOKING_RATE_LIMIT_THRESHOLD + 1)
    expect(decision.allowed).toBe(false)

    // And the increment landed back in the same row rather than a new one.
    const rows = await superuserPrisma.rateLimit.findMany({ where: { key } })
    expect(rows).toHaveLength(1)
    expect(rows[0].count).toBe(BOOKING_RATE_LIMIT_THRESHOLD + 1)
  })

  it("updates one row per key in place instead of appending a row per attempt", async () => {
    const ip = testIp()
    const key = rateLimitKey("login", ip)
    const now = new Date()

    for (let attempt = 1; attempt <= 5; attempt++) {
      await consumeRateLimit(LOGIN_RATE_LIMIT, ip, now)
    }

    // The app role has no DELETE grant, so unbounded growth here would be
    // unrecoverable from inside the app. One row, count 5.
    const rows = await superuserPrisma.rateLimit.findMany({ where: { key } })
    expect(rows).toHaveLength(1)
    expect(rows[0].count).toBe(5)
    expect(rows[0].windowStart.getTime()).toBe(now.getTime())
  })

  it("puts requests with no derivable address in the shared per-surface bucket", async () => {
    const before = await superuserPrisma.rateLimit.findUnique({
      where: { key: `login:${UNKNOWN_SOURCE}` },
    })
    const decision = await consumeRateLimit(LOGIN_RATE_LIMIT, null, new Date())

    expect(decision.key).toBe(`login:${UNKNOWN_SOURCE}`)
    expect(decision.ip).toBeNull()
    // Still counted — the fallback is a shared bucket, never a skipped check.
    expect(decision.count).toBe((before?.count ?? 0) + 1)
  })

  it("audits only the transition into a blocked state, once per window", async () => {
    const ip = testIp()
    const now = new Date()

    for (let attempt = 1; attempt <= BOOKING_RATE_LIMIT_THRESHOLD; attempt++) {
      await consumeRateLimit(BOOKING_RATE_LIMIT, ip, now)
    }
    expect(
      await superuserPrisma.auditLog.count({ where: { action: "rate_limit.block", ipAddress: ip } })
    ).toBe(0)

    // Cross the threshold, then keep hammering. Auditing every refusal
    // would let an attacker flood audit_logs on purpose.
    for (let extra = 0; extra < 6; extra++) {
      await consumeRateLimit(BOOKING_RATE_LIMIT, ip, now)
    }

    const logs = await superuserPrisma.auditLog.findMany({ where: { action: "rate_limit.block", ipAddress: ip } })
    expect(logs).toHaveLength(1)
    expect(logs[0].entityType).toBe("RateLimit")
    expect(logs[0].entityId).toBe("booking")
    // branch_id IS NULL is the arm of the audit_logs INSERT policy that
    // lets this anonymous, session-less write through at all.
    expect(logs[0].branchId).toBeNull()
    expect(logs[0].userId).toBeNull()
    expect(logs[0].changes).toMatchObject({ surface: "booking", limit: BOOKING_RATE_LIMIT_THRESHOLD })
  })

  it("increments atomically under concurrent requests", async () => {
    const ip = testIp()
    const now = new Date()

    // The failure this guards against: two requests both read count = n
    // and both write n + 1, so the attacker gets extra attempts for free.
    // With a single INSERT … ON CONFLICT … RETURNING every caller must see
    // a distinct count.
    const parallel = BOOKING_RATE_LIMIT_THRESHOLD + 4
    const decisions = await Promise.all(
      Array.from({ length: parallel }, () => consumeRateLimit(BOOKING_RATE_LIMIT, ip, now))
    )

    const counts = decisions.map((d) => d.count).sort((a, b) => a - b)
    expect(counts).toEqual(Array.from({ length: parallel }, (_, i) => i + 1))
    expect(decisions.filter((d) => d.allowed)).toHaveLength(BOOKING_RATE_LIMIT_THRESHOLD)
    expect(decisions.filter((d) => d.firstBlock)).toHaveLength(1)
  })
})
