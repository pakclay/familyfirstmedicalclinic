import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { navForRole } from "@/lib/nav"
import { getAppName } from "@/lib/branding"
import { AppHeader } from "@/components/nav/app-header"

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const nav = navForRole(session.user.role)

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader
        navItems={nav}
        userLabel={`${session.user.name} · ${session.user.role.replace("_", " ")}`}
        brand={await getAppName()}
      />
      <main className="flex-1 p-4 sm:p-6">{children}</main>
    </div>
  )
}
