import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getAppName } from "@/lib/branding"
import { AppHeader } from "@/components/nav/app-header"

const STAFF_NAV = [
  { label: "Queue", href: "/staff/queue" },
  { label: "Register walk-in", href: "/staff/register" },
  { label: "Patients", href: "/staff/patients" },
  { label: "Inventory", href: "/staff/inventory" },
  { label: "Follow-ups", href: "/staff/follow-ups" },
  { label: "Notifications", href: "/staff/notifications" },
  { label: "Remittance", href: "/staff/remittance" },
]

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) redirect("/login")

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader navItems={STAFF_NAV} userLabel={session.user.name ?? ""} brand={await getAppName()} />
      <main className="flex-1 p-4 sm:p-6">{children}</main>
    </div>
  )
}
