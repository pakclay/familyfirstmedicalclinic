import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { AppHeader } from "@/components/nav/app-header"

const DOCTOR_NAV = [
  { label: "My queue", href: "/doctor/queue" },
  { label: "My collections", href: "/doctor/collections" },
  { label: "Remittance", href: "/doctor/remittance" },
]

export default async function DoctorLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) redirect("/login")

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader navItems={DOCTOR_NAV} userLabel={session.user.name ?? ""} />
      <main className="flex-1 p-4 sm:p-6">{children}</main>
    </div>
  )
}
