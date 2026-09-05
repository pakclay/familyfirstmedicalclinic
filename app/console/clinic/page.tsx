import { redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { getOwnClinic, listBranches } from "@/lib/queries/branches"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { Button } from "@/components/ui/button"
import { BranchRowActions } from "./branch-row-actions"

/**
 * A clinic admin's own clinic — singular, session-derived, no id in the
 * URL. Mirrors /console/settings (a branch admin's own branch) rather than
 * /console/clinics/[id], which is the holding admin's view of *any* clinic
 * and whose gate must stay holding-admin-only. See app/console/clinic/actions.ts.
 */
export default async function OwnClinicPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")
  // proxy.ts admits all three admin tiers to /console; the page narrows.
  // Refused in place rather than redirected, so a deliberate boundary does
  // not read as a broken link — same shape as the expenses page's gate.
  if (session.user.role !== "CLINIC_ADMIN") {
    return (
      <div>
        <h1 className="text-2xl font-heading font-semibold">Branches</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Only a clinic admin manages branches here. Holding admins manage every clinic from{" "}
          <Link href="/console/clinics" className="underline">
            Clinics
          </Link>
          .
        </p>
      </div>
    )
  }

  const actor: AbilitySubject = {
    id: session.user.id,
    role: session.user.role,
    branchId: session.user.branchId,
    clinicId: session.user.clinicId,
    holdingCompanyId: session.user.holdingCompanyId,
  }
  const clinic = await getOwnClinic(actor)
  const branches = await listBranches(actor)

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-heading font-semibold">{clinic.name}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        The physical locations patients book into. Staff accounts are managed under{" "}
        <Link href="/console/users" className="underline">
          Users
        </Link>
        .
      </p>

      <div className="mt-6 border-t border-border pt-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase text-muted-foreground">Branches</p>
          <Button asChild size="sm">
            <Link href="/console/clinic/branches/new">Add branch</Link>
          </Button>
        </div>

        <ul className="mt-2 divide-y divide-border rounded-md border border-border">
          {branches.map((b) => (
            <li key={b.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                {/* No detail link: editing a branch's address or hours is
                    holding-admin-only. This role creates and deactivates. */}
                <span className="font-medium">{b.name}</span>
                {!b.isActive && <span className="ml-2 text-xs text-destructive">Inactive</span>}
                <p className="truncate text-xs text-muted-foreground">
                  /{b.slug} · {b.city} · {b.phone}
                </p>
              </div>
              <BranchRowActions branchId={b.id} isActive={b.isActive} />
            </li>
          ))}
          {branches.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-muted-foreground">No branches yet.</li>
          )}
        </ul>
      </div>
    </div>
  )
}
