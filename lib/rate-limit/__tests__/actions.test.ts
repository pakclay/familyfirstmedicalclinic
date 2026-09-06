import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { superuserPrisma } from "@/lib/test/superuser-prisma"
import { prisma } from "@/lib/db/prisma"
import { rateLimitKey } from "@/lib/rate-limit/key"
import {
  BOOKING_RATE_LIMIT,
  BOOKING_RATE_LIMIT_THRESHOLD,
  LOGIN_RATE_LIMIT,
  LOGIN_RATE_LIMIT_THRESHOLD,
  rateLimitMessage,
} from "@/lib/rate-limit/policy"

/**
 * The wiring, not the limiter: proves the two server actions actually
 * consult it *before* doing anything else, that a blocked caller never
 * reaches the credential check or the booking write, and that the message
 * the form receives is the explicit throttle one rather than the generic
 * credential error.
 */

const stub = vi.hoisted(() => ({ ip: "" }))

vi.mock("next/headers", () => ({
  // The one header the deployment can be trusted on — see lib/rate-limit/key.ts.
  headers: async () => new Headers(stub.ip ? { "x-vercel-forwarded-for": stub.ip } : {}),
}))

const signIn = vi.hoisted(() => vi.fn())
vi.mock("@/auth", () => ({ signIn }))

// The action imports `AuthError` from next-auth for its catch branch, and
// next-auth's module graph reaches `next/server`, which does not resolve
// outside a Next build. Only the class identity matters here.
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }))

const createPublicBooking = vi.hoisted(() => vi.fn())
vi.mock("@/lib/queries/booking", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries/booking")>()
  return { ...actual, createPublicBooking }
})

const { loginAction } = await import("@/app/login/actions")
const { createBookingAction } = await import("@/app/book/[slug]/actions")

const usedIps: string[] = []

function testIp(): string {
  const octet = () => Math.floor(Math.random() * 254) + 1
  const ip = `10.${octet()}.${octet()}.${octet()}`
  usedIps.push(ip)
  stub.ip = ip
  return ip
}

function loginForm(email = "someone@test.local", password = "hunter2-hunter2"): FormData {
  const fd = new FormData()
  fd.set("email", email)
  fd.set("password", password)
  fd.set("next", "/")
  return fd
}

beforeEach(() => {
  signIn.mockReset()
  createPublicBooking.mockReset()
})

afterAll(async () => {
  const keys = usedIps.flatMap((ip) => [rateLimitKey("login", ip), rateLimitKey("booking", ip)])
  await superuserPrisma.rateLimit.deleteMany({ where: { key: { in: keys } } })
  await superuserPrisma.auditLog.deleteMany({ where: { action: "rate_limit.block", ipAddress: { in: usedIps } } })
  await superuserPrisma.$disconnect()
  await prisma.$disconnect()
})

describe("loginAction rate limiting", () => {
  it("refuses before touching signIn once the source is over its budget", async () => {
    const ip = testIp()
    const now = new Date()
    await superuserPrisma.rateLimit.create({
      data: { key: rateLimitKey("login", ip), count: LOGIN_RATE_LIMIT_THRESHOLD, windowStart: now, updatedAt: now },
    })

    const state = await loginAction({ error: null }, loginForm())

    // Never reaches the credential check: no `users` read, no bcrypt
    // compare, no contribution to the per-account lockout.
    expect(signIn).not.toHaveBeenCalled()
    expect(state.error).not.toBe("Incorrect email or password.")
    expect(state.error).toContain("Too many sign-in attempts from this network")
    expect(state.error).toMatch(/try again in about \d+ minutes?/i)
  })

  it("lets a request through and calls signIn while inside the budget", async () => {
    testIp()
    const state = await loginAction({ error: null }, loginForm())

    expect(signIn).toHaveBeenCalledTimes(1)
    expect(state.error).toBeNull()
  })

  it("does NOT reset the counter on a successful sign-in", async () => {
    // The deliberate choice (documented in app/login/actions.ts): the
    // per-account lockout clears on success because a correct password
    // proves who the actor is; a shared source address proves nothing, so
    // resetting here would let anyone holding one valid credential wipe
    // the budget and keep spraying.
    const ip = testIp()

    await loginAction({ error: null }, loginForm())
    await loginAction({ error: null }, loginForm())
    await loginAction({ error: null }, loginForm())

    expect(signIn).toHaveBeenCalledTimes(3)
    const row = await superuserPrisma.rateLimit.findUnique({ where: { key: rateLimitKey("login", ip) } })
    expect(row?.count).toBe(3)
  })

  it("reports a wait derived from the surface's own window", async () => {
    const ip = testIp()
    const now = new Date()
    await superuserPrisma.rateLimit.create({
      data: { key: rateLimitKey("login", ip), count: LOGIN_RATE_LIMIT_THRESHOLD, windowStart: now, updatedAt: now },
    })

    const state = await loginAction({ error: null }, loginForm())
    expect(state.error).toBe(rateLimitMessage(LOGIN_RATE_LIMIT, LOGIN_RATE_LIMIT.windowMs))
  })
})

describe("createBookingAction rate limiting", () => {
  it("refuses before any validation or write once the source is over its budget", async () => {
    const ip = testIp()
    const now = new Date()
    await superuserPrisma.rateLimit.create({
      data: {
        key: rateLimitKey("booking", ip),
        count: BOOKING_RATE_LIMIT_THRESHOLD,
        windowStart: now,
        updatedAt: now,
      },
    })

    const result = await createBookingAction("any-clinic", { firstName: "Ana" })

    expect(createPublicBooking).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toBe(
      rateLimitMessage(BOOKING_RATE_LIMIT, BOOKING_RATE_LIMIT.windowMs)
    )
  })

  it("lets a request through while inside the budget", async () => {
    testIp()
    createPublicBooking.mockResolvedValue({
      patient: { id: "p1" },
      queueEntry: { id: "q1" },
      clinicName: "Test Clinic",
      accessToken: "tok",
    })

    const result = await createBookingAction("any-clinic", { firstName: "Ana" })

    expect(createPublicBooking).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(true)
  })

  it("does not let a spent booking budget block sign-in from the same network", async () => {
    const ip = testIp()
    const now = new Date()
    await superuserPrisma.rateLimit.create({
      data: {
        key: rateLimitKey("booking", ip),
        count: BOOKING_RATE_LIMIT_THRESHOLD + 5,
        windowStart: now,
        updatedAt: now,
      },
    })

    const booking = await createBookingAction("any-clinic", { firstName: "Ana" })
    expect(booking.ok).toBe(false)

    const login = await loginAction({ error: null }, loginForm())
    expect(login.error).toBeNull()
    expect(signIn).toHaveBeenCalledTimes(1)
  })
})
