import { afterEach, describe, expect, it, vi } from "vitest"
import { warnIfSessionPooler } from "@/lib/db/prisma"

/**
 * The check that would have named the 2026-09-06 outage before it happened:
 * APP_DATABASE_URL on Supabase's session-mode pooler. It only ever inspects
 * the URL's shape and must never print the URL itself — the password is in
 * it.
 */
describe("warnIfSessionPooler", () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {})
  afterEach(() => spy.mockClear())

  const SECRET = "s3cret-pw"
  const session = `postgresql://webinar_app.abc:${SECRET}@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`
  const txNoFlag = `postgresql://webinar_app.abc:${SECRET}@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`
  const txGood = `${txNoFlag}?pgbouncer=true&connection_limit=5`

  it("flags Supabase's pooler on port 5432 (session mode)", () => {
    warnIfSessionPooler(session)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toContain("SESSION mode")
    expect(spy.mock.calls[0][0]).toContain("6543")
  })

  it("flags transaction mode without pgbouncer=true", () => {
    warnIfSessionPooler(txNoFlag)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toMatch(/pgbouncer=true/)
  })

  it("is silent for the correct production shape, for local Postgres, and for no URL", () => {
    warnIfSessionPooler(txGood)
    warnIfSessionPooler("postgresql://webinar_app:pw@localhost:5432/familyfirst_dev")
    warnIfSessionPooler(undefined)
    warnIfSessionPooler("not a url")
    expect(spy).not.toHaveBeenCalled()
  })

  it("never prints the URL — and so never the password", () => {
    warnIfSessionPooler(session)
    warnIfSessionPooler(txNoFlag)
    for (const call of spy.mock.calls) {
      expect(String(call[0])).not.toContain(SECRET)
      expect(String(call[0])).not.toContain("pooler.supabase.com")
    }
  })
})
