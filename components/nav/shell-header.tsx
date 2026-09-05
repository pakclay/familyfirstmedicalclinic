import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getAppName } from "@/lib/branding"
import { navForRole } from "@/lib/nav"
import { AppHeader, type HeaderNavItem } from "./app-header"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * The header for all three authenticated shells, as a component the layout
 * renders *inside* `<Suspense>` rather than awaiting itself.
 *
 * That structure is the point. `loading.js` sits below `layout.js` in the
 * component hierarchy, so it cannot cover runtime data access in the layout
 * itself — and without Cache Components, "the navigation will block until
 * the layout finishes rendering, and the `loading.js` fallback will not be
 * shown" (next/dist/docs/.../file-conventions/layout.md, "Interaction with
 * `loading.js`"). Each shell layout used to `await auth()` and
 * `await getAppName()` at its top level, which put two sequential database
 * round trips on the critical path of every single navigation and silently
 * disabled the loading fallback for every page beneath it. Keeping that
 * work here, behind a boundary, is the fix the docs prescribe.
 *
 * The two reads are independent, so they run together rather than in
 * sequence — that alone removes one full round trip per navigation.
 */
export async function ShellHeader({
  navItems,
  showRole = false,
}: {
  /** Omit to derive the nav from the signed-in user's role (the console). */
  navItems?: HeaderNavItem[]
  /** The console names the role next to the user; staff and doctor don't. */
  showRole?: boolean
}) {
  const [session, brand] = await Promise.all([auth(), getAppName()])

  // Defence in depth, not the gate. proxy.ts already redirects a signed-out
  // request before it reaches any of this, and every page re-checks with its
  // own auth() call — so moving this out of the layout body costs no real
  // protection, it just stops an unauthenticated render from getting further
  // than the header.
  if (!session?.user) redirect("/login")

  const items = navItems ?? navForRole(session.user.role)
  const userLabel = showRole
    ? `${session.user.name} · ${session.user.role.replace("_", " ")}`
    : session.user.name ?? ""

  return <AppHeader navItems={items} userLabel={userLabel} brand={brand} />
}

/**
 * Stands in for the header while the session and brand name resolve. Mirrors
 * AppHeader's own padding and control sizes so the real header replacing it
 * doesn't shift the page underneath.
 */
export function ShellHeaderSkeleton() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85">
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 sm:px-4 sm:py-3">
        <div className="flex min-w-0 items-center gap-1 sm:gap-4">
          <Skeleton className="size-9 shrink-0 sm:hidden" />
          <Skeleton className="hidden h-6 w-44 sm:block" />
          <div className="hidden items-center gap-1 sm:flex">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-5 w-16" />
            ))}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <Skeleton className="hidden h-4 w-32 sm:block" />
          <Skeleton className="h-8 w-20" />
        </div>
      </div>
    </header>
  )
}
