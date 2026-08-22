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

// Which roles may enter each authenticated shell. Checked in order — the
// first matching prefix wins, so a more specific prefix must come first.
const SECTION_ACCESS: { prefix: string; roles: string[] }[] = [
  { prefix: "/staff", roles: ["FRONT_DESK", "CLINIC_ADMIN", "HOLDING_ADMIN"] },
  { prefix: "/doctor", roles: ["DOCTOR"] },
  { prefix: "/console", roles: ["CLINIC_ADMIN", "HOLDING_ADMIN"] },
]

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
  const section = SECTION_ACCESS.find((s) => pathname.startsWith(s.prefix))
  if (section && !section.roles.includes(role)) {
    return NextResponse.redirect(new URL(ROLE_HOME[role] ?? "/login", req.nextUrl.origin))
  }

  return NextResponse.next()
})

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
