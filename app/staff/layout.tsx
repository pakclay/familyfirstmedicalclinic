import { Suspense } from "react"
import { ShellHeader, ShellHeaderSkeleton } from "@/components/nav/shell-header"
import { DOCTOR_NAV, STAFF_NAV } from "@/lib/nav"

/**
 * Not async on purpose — see components/nav/shell-header.tsx.
 *
 * The nav is chosen by role rather than fixed: a doctor can reach exactly one
 * page under /staff, the medicine catalog (proxy.ts), and must keep their
 * own header there — the staff links would each bounce them to /doctor/queue.
 * Everyone else on this floor gets the staff nav, admins included, because
 * the header reflects the section you are standing in, not the role you hold.
 */
export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <Suspense fallback={<ShellHeaderSkeleton />}>
        <ShellHeader navItems={(role) => (role === "DOCTOR" ? DOCTOR_NAV : STAFF_NAV)} />
      </Suspense>
      <main className="flex-1 p-4 sm:p-6">{children}</main>
    </div>
  )
}
