import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { SignOutButton } from "@/components/console/sign-out-button"

const STAFF_NAV = [
  { label: "Queue", href: "/staff/queue" },
  { label: "Register walk-in", href: "/staff/register" },
  { label: "Patients", href: "/staff/patients" },
  { label: "Inventory", href: "/staff/inventory" },
  { label: "Follow-ups", href: "/staff/follow-ups" },
  { label: "Notifications", href: "/staff/notifications" },
]

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) redirect("/login")

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <nav className="flex items-center gap-1">
          {STAFF_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-sm font-medium hover:bg-accent"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{session.user.name}</span>
          <SignOutButton />
        </div>
      </header>
      <main className="flex-1 p-4 sm:p-6">{children}</main>
    </div>
  )
}
