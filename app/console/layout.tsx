import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/db/prisma"
import { navForRole } from "@/lib/nav"
import { ROLE_LABELS } from "@/lib/role-labels"
import { SidebarNav } from "@/components/console/sidebar-nav"
import { SignOutButton } from "@/components/console/sign-out-button"

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user || !session.user.isActive) {
    redirect("/login")
  }

  const { user } = session
  const branch = user.homeBranchId
    ? await prisma.branch.findUnique({ where: { id: user.homeBranchId }, select: { name: true } })
    : null

  const items = navForRole(user.role)

  return (
    <div className="flex min-h-screen w-full">
      <aside className="flex w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground">
        <div className="px-5 py-6">
          <p className="font-heading text-lg font-bold tracking-tight">Stretch Lab PH</p>
          <p className="text-xs text-sidebar-foreground/60">Performance Recovery · Body Tune-Up · Pain Management</p>
        </div>
        <SidebarNav items={items} />
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border bg-card px-6 py-4">
          <div>
            <p className="text-sm font-medium">{user.name}</p>
            <p className="text-xs text-muted-foreground">
              {ROLE_LABELS[user.role]}
              {branch ? ` · ${branch.name}` : user.role === "OWNER" ? " · All branches" : ""}
            </p>
          </div>
          <SignOutButton />
        </header>
        <main className="flex-1 bg-background p-6">{children}</main>
      </div>
    </div>
  )
}
