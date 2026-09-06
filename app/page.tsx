import { redirect } from "next/navigation"
import { auth } from "@/auth"
import type { Role } from "@prisma/client"

const ROLE_HOME: Record<Role, string> = {
  FRONT_DESK: "/staff/queue",
  DOCTOR: "/doctor/queue",
  BRANCH_ADMIN: "/console/dashboard",
  HOLDING_ADMIN: "/console/dashboard",
}

export default async function RootPage() {
  const session = await auth()
  redirect(session?.user ? (ROLE_HOME[session.user.role] ?? "/login") : "/login")
}
