import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { navForRole } from "@/lib/nav"
import { SignOutButton } from "@/components/console/sign-out-button"

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const nav = navForRole(session.user.role)

  return (
    <div className="flex min-h-full">
      <aside className="flex w-56 shrink-0 flex-col gap-1 border-r border-sidebar-border bg-sidebar p-4 text-sidebar-foreground">
        <div className="mb-4 font-heading text-sm font-semibold">Family First</div>
        {nav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-md px-3 py-2 text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            {item.label}
          </Link>
        ))}
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border px-6 py-3">
          <span className="text-sm text-muted-foreground">
            {session.user.name} · {session.user.role.replace("_", " ")}
          </span>
          <SignOutButton />
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  )
}
