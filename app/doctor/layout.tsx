import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { SignOutButton } from "@/components/console/sign-out-button"

const DOCTOR_NAV = [
  { label: "My queue", href: "/doctor/queue" },
  { label: "My collections", href: "/doctor/collections" },
]

export default async function DoctorLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) redirect("/login")

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <nav className="flex items-center gap-1">
          {DOCTOR_NAV.map((item) => (
            <Link key={item.href} href={item.href} className="rounded-md px-3 py-2 text-sm font-medium hover:bg-accent">
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
