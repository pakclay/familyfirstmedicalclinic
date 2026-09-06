import { afterEach, describe, expect, it, vi } from "vitest"
import { warnIfSessionPooler } from "@/lib/db/prisma"
import { poolMaxFromUrl, sslFromUrl } from "@/lib/db/client-factory"

const SECRET = "s3cret-pw"
const session = `postgresql://webinar_app.abc:${SECRET}@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`
const transaction = `postgresql://webinar_app.abc:${SECRET}@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?connection_limit=5`
const local = "postgresql://webinar_app:pw@localhost:5432/familyfirst_dev"

/**
 * The check that would have named the 2026-09-06 outage before it happened:
 * APP_DATABASE_URL on Supabase's session-mode pooler. It only ever inspects
 * the URL's shape and must never print the URL itself — the password is in
 * it.
 */
describe("warnIfSessionPooler", () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {})
  afterEach(() => spy.mockClear())

  it("flags Supabase's pooler on port 5432 (session mode)", () => {
    warnIfSessionPooler(session)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toContain("SESSION mode")
    expect(spy.mock.calls[0][0]).toContain("6543")
  })

  it("is silent for transaction mode, for local Postgres, and for no URL", () => {
    warnIfSessionPooler(transaction)
    // pgbouncer=true meant something to the old engine; the pg driver ignores it, and so does this.
    warnIfSessionPooler(`${transaction}&pgbouncer=true`)
    warnIfSessionPooler(local)
    warnIfSessionPooler(undefined)
    warnIfSessionPooler("not a url")
    expect(spy).not.toHaveBeenCalled()
  })

  it("never prints the URL — and so never the password", () => {
    warnIfSessionPooler(session)
    for (const call of spy.mock.calls) {
      expect(String(call[0])).not.toContain(SECRET)
      expect(String(call[0])).not.toContain("pooler.supabase.com")
    }
  })
})

/**
 * What the old Rust engine read off the connection string and the pg driver
 * does not — carried over in lib/db/client-factory.ts. See that file.
 */
describe("poolMaxFromUrl", () => {
  it("turns connection_limit into the pool size, and leaves the driver's default alone otherwise", () => {
    expect(poolMaxFromUrl(transaction)).toBe(5)
    expect(poolMaxFromUrl(session)).toBeUndefined()
    expect(poolMaxFromUrl(local)).toBeUndefined()
  })

  it("ignores a value that isn't a positive whole number, and a string that isn't a URL", () => {
    expect(poolMaxFromUrl(`${local}?connection_limit=0`)).toBeUndefined()
    expect(poolMaxFromUrl(`${local}?connection_limit=abc`)).toBeUndefined()
    expect(poolMaxFromUrl(`${local}?connection_limit=2.5`)).toBeUndefined()
    expect(poolMaxFromUrl("not a url")).toBeUndefined()
  })
})

describe("sslFromUrl", () => {
  it("encrypts to a remote host without verifying, matching the engine's old sslmode=prefer", () => {
    expect(sslFromUrl(transaction)).toEqual({ rejectUnauthorized: false })
    expect(sslFromUrl(session)).toEqual({ rejectUnauthorized: false })
  })

  it("leaves local Postgres in the clear, as the engine did", () => {
    expect(sslFromUrl(local)).toBeUndefined()
    expect(sslFromUrl("postgresql://u:p@127.0.0.1:5432/db")).toBeUndefined()
  })

  it("defers to a URL that states its own sslmode, whatever it says", () => {
    expect(sslFromUrl(`${transaction}&sslmode=verify-full`)).toBeUndefined()
    expect(sslFromUrl(`${transaction}&sslmode=disable`)).toBeUndefined()
    expect(sslFromUrl("not a url")).toBeUndefined()
  })
})
