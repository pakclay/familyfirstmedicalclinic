import { Suspense } from "react"
import { ShellHeader, ShellHeaderSkeleton } from "@/components/nav/shell-header"

/**
 * Deliberately not `async` and deliberately awaiting nothing: a top-level
 * await here (this used to call `auth()` and `getAppName()`) blocks every
 * navigation on the layout and suppresses `loading.tsx` for every page
 * below it. See components/nav/shell-header.tsx.
 */
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <Suspense fallback={<ShellHeaderSkeleton />}>
        <ShellHeader showRole />
      </Suspense>
      <main className="flex-1 p-4 sm:p-6">{children}</main>
    </div>
  )
}
