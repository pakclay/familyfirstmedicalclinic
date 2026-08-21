import { redirect } from "next/navigation"
import { auth } from "@/auth"

const ROLE_HOME: Record<string, string> = {
  FRONT_DESK: "/staff/queue",
  DOCTOR: "/doctor/queue",
  CLINIC_ADMIN: "/console/dashboard",
  HOLDING_ADMIN: "/console/dashboard",
}

export default async function RootPage() {
  const session = await auth()
  redirect(session?.user ? (ROLE_HOME[session.user.role] ?? "/login") : "/login")
}
