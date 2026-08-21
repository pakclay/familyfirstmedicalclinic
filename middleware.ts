import { NextResponse } from "next/server"
import NextAuth from "next-auth"
import { authConfig } from "@/auth.config"

// Uses the edge-safe config directly (not auth.ts's full config) — Prisma
// Client can't run on Next.js's Edge runtime, which is what middleware
// always executes on. See auth.config.ts.
const { auth } = NextAuth(authConfig)

const ROLE_HOME: Record<string, string> = {
  FRONT_DESK: "/staff/queue",
  DOCTOR: "/doctor/queue",
  CLINIC_ADMIN: "/console/dashboard",
  HOLDING_ADMIN: "/console/dashboard",
}

// Public routes never require a session: the public booking flow, the
// patient status/display screens (token- or slug-gated, not login-gated —
// §4: "Patients never authenticate"), and auth itself.
const PUBLIC_PREFIXES = ["/book/", "/q/", "/display/", "/login", "/api/auth"]

export default auth((req) => {
  const { pathname } = req.nextUrl
  if (pathname === "/" || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  const session = req.auth
  if (!session?.user) {
    const loginUrl = new URL("/login", req.nextUrl.origin)
    loginUrl.searchParams.set("next", pathname)
    return NextResponse.redirect(loginUrl)
  }

  const role = session.user.role
  if (pathname.startsWith("/staff") && role !== "FRONT_DESK" && role !== "CLINIC_ADMIN" && role !== "HOLDING_ADMIN") {
    return NextResponse.redirect(new URL(ROLE_HOME[role] ?? "/login", req.nextUrl.origin))
  }
  if (pathname.startsWith("/doctor") && role !== "DOCTOR") {
    return NextResponse.redirect(new URL(ROLE_HOME[role] ?? "/login", req.nextUrl.origin))
  }
  if (pathname.startsWith("/console") && role !== "CLINIC_ADMIN" && role !== "HOLDING_ADMIN") {
    return NextResponse.redirect(new URL(ROLE_HOME[role] ?? "/login", req.nextUrl.origin))
  }

  return NextResponse.next()
})

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
