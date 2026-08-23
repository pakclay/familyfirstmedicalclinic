import { redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { listClinics } from "@/lib/queries/clinics"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { Button } from "@/components/ui/button"
import { ClinicRowActions } from "./clinic-row-actions"

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
    clinicId: session.user.clinicId,
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

      <ul className="mt-4 divide-y divide-border rounded-md border border-border">
        {clinics.map((c) => (
          <li key={c.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <Link href={`/console/clinics/${c.id}`} className="font-medium hover:underline">
                {c.name}
              </Link>
              {!c.isActive && <span className="ml-2 text-xs text-destructive">Inactive</span>}
              <p className="truncate text-xs text-muted-foreground">
                /{c.slug} · {c.city} · {c.phone}
              </p>
            </div>
            <ClinicRowActions clinicId={c.id} isActive={c.isActive} />
          </li>
        ))}
        {clinics.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">No clinics yet.</li>
        )}
      </ul>
    </div>
  )
}
