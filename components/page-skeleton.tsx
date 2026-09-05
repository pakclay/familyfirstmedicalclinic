import { Skeleton } from "@/components/ui/skeleton"

/**
 * The placeholder every authenticated shell shows while a route segment is
 * still rendering on the server (app/{console,staff,doctor}/loading.tsx).
 *
 * Every screen in this app reads `cookies()` through `auth()`, which makes
 * all of them dynamic: there is no static output to show, so without a
 * loading boundary a click leaves the *previous* page on screen, fully
 * interactive-looking, until the server round trip finishes. Against a
 * database in another region that reads as "the menu is broken" rather than
 * "the page is loading" — the complaint this was added for.
 *
 * Deliberately generic rather than per-route: it stands in for a heading
 * and a list/table, which is the shape of nearly every screen here, and a
 * shared boundary can't know which one it's covering. A route with a very
 * different shape can add its own `loading.tsx` next to its `page.tsx`,
 * which takes precedence over this one.
 */
export function PageSkeleton() {
  return (
    <div className="mx-auto max-w-3xl" aria-hidden="true">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="mt-3 h-4 w-72" />

      <div className="mt-6 divide-y divide-border rounded-md border border-border">
        {/* Fixed count, fixed widths: the real row count isn't known yet, and
            a random-width shimmer would move on every render. */}
        {[0, 1, 2, 3, 4].map((row) => (
          <div key={row} className="flex items-center justify-between gap-4 px-4 py-3.5">
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="mt-2 h-3 w-56" />
            </div>
            <Skeleton className="h-8 w-20 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  )
}
