import { redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { listClinics } from "@/lib/queries/clinics"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { Button } from "@/components/ui/button"

export default async function ClinicsPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")
  // proxy.ts's /console gate allows CLINIC_ADMIN too, so the page narrows
  // it to holding admin itself — same shape as the expenses page's
  // clinic-admin-only gate.
  if (session.user.role !== "HOLDING_ADMIN") {
    return (
      <div>
        <h1 className="text-2xl font-heading font-semibold">Clinics</h1>
        <p className="mt-2 text-sm text-muted-foreground">Only a holding admin manages clinics.</p>
      </div>
    )
  }

  const user: AbilitySubject = {
    id: session.user.id,
    role: session.user.role,
    branchId: session.user.branchId,
    holdingCompanyId: session.user.holdingCompanyId,
  }
  const clinics = await listClinics(user)

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-heading font-semibold">Clinics</h1>
        <Button asChild>
          <Link href="/console/clinics/new">Add clinic</Link>
        </Button>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        A clinic is the organization; each clinic can have multiple branches, the physical locations patients book
        into. Open a clinic to add or manage its branches.
      </p>

      <ul className="mt-4 divide-y divide-border rounded-md border border-border">
        {clinics.map((c) => (
          <li key={c.id} className="flex items-center justify-between px-4 py-3">
            <Link href={`/console/clinics/${c.id}`} className="font-medium hover:underline">
              {c.name}
            </Link>
          </li>
        ))}
        {clinics.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">No clinics yet.</li>
        )}
      </ul>
    </div>
  )
}
