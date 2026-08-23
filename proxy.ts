import { NextResponse } from "next/server"
import NextAuth from "next-auth"
import { authConfig } from "@/auth.config"

// Uses the edge-safe config directly (not auth.ts's full config), even
// though proxy.ts runs on the Node.js runtime (unlike the old middleware.ts
// convention, proxy's runtime is fixed to nodejs and isn't configurable) —
// so Prisma could run here now. Deliberately still doesn't: auth.config.ts's
// session callback only reads already-encoded JWT claims, so this coarse
// first gate (redirect signed-out/wrong-role requests) needs no DB round
// trip. auth.ts's jwt callback re-checks isActive against Prisma, but that
// only needs to run where it's the actual authorization boundary — every
// query-layer call via auth.ts's auth() — not on every navigation here,
// which would add a DB read to this matcher's near-universal route coverage
// for no security benefit (a deactivated user's stale JWT would still pass
// this gate either way; the real block happens at the query layer). See
// auth.config.ts.
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
