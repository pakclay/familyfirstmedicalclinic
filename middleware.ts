import { NextResponse } from "next/server"
import { auth } from "@/auth"

// Database session strategy needs Prisma at request time, so this
// middleware runs on the Node.js runtime rather than the default Edge
// runtime (Next.js 15 supports this via `export const runtime`).
export const runtime = "nodejs"

export default auth((req) => {
  const isLoggedIn = !!req.auth?.user && req.auth.user.isActive
  const isConsoleRoute = req.nextUrl.pathname.startsWith("/console")
  const isLoginRoute = req.nextUrl.pathname === "/login"

  if (isConsoleRoute && !isLoggedIn) {
    const loginUrl = new URL("/login", req.nextUrl.origin)
    loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname)
    return NextResponse.redirect(loginUrl)
  }

  if (isLoginRoute && isLoggedIn) {
    return NextResponse.redirect(new URL("/console", req.nextUrl.origin))
  }

  return NextResponse.next()
})

export const config = {
  matcher: ["/console/:path*", "/login"],
}
