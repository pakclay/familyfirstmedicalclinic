import { Suspense } from "react"
import { ShellHeader, ShellHeaderSkeleton } from "@/components/nav/shell-header"

const DOCTOR_NAV = [
  { label: "My queue", href: "/doctor/queue" },
  { label: "My collections", href: "/doctor/collections" },
  { label: "Remittance", href: "/doctor/remittance" },
]

/** Not async on purpose — see components/nav/shell-header.tsx. */
export default function DoctorLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <Suspense fallback={<ShellHeaderSkeleton />}>
        <ShellHeader navItems={DOCTOR_NAV} />
      </Suspense>
      <main className="flex-1 p-4 sm:p-6">{children}</main>
    </div>
  )
}
