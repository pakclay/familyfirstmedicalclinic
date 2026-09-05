import { Suspense } from "react"
import { ShellHeader, ShellHeaderSkeleton } from "@/components/nav/shell-header"

const STAFF_NAV = [
  { label: "Queue", href: "/staff/queue" },
  { label: "Register walk-in", href: "/staff/register" },
  { label: "Patients", href: "/staff/patients" },
  { label: "Inventory", href: "/staff/inventory" },
  { label: "Follow-ups", href: "/staff/follow-ups" },
  { label: "Notifications", href: "/staff/notifications" },
  { label: "Remittance", href: "/staff/remittance" },
]

/** Not async on purpose — see components/nav/shell-header.tsx. */
export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <Suspense fallback={<ShellHeaderSkeleton />}>
        <ShellHeader navItems={STAFF_NAV} />
      </Suspense>
      <main className="flex-1 p-4 sm:p-6">{children}</main>
    </div>
  )
}
