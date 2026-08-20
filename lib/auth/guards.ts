import { redirect } from "next/navigation"
import { auth } from "@/auth"
import type { Role } from "@/lib/permissions/ability"

/**
 * Page-level guard for a route only certain roles should even load.
 * Not the security boundary (Phase 2's scopedPrisma + RLS + DTOs are) —
 * this just stops an unauthorized role from rendering a page whose nav
 * item they can't see, if they type the URL directly.
 */
export async function requireRole(allowed: Role[]) {
  const session = await auth()
  if (!session?.user || !session.user.isActive) {
    redirect("/login")
  }
  if (!allowed.includes(session.user.role)) {
    redirect("/console/dashboard")
  }
  return session.user
}

export async function requireSession() {
  const session = await auth()
  if (!session?.user || !session.user.isActive) {
    redirect("/login")
  }
  return session.user
}
