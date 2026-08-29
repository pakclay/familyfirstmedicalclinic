import { redirect, notFound } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { getClinicById } from "@/lib/queries/clinics"
import { getBranchById } from "@/lib/queries/branches"
import { listUsersForBranch } from "@/lib/queries/users"
import { ROLE_LABEL } from "@/lib/dto/user"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { Button } from "@/components/ui/button"
import { EditBranchForm } from "./edit-branch-form"
import { BranchDetailActions } from "./branch-detail-actions"
import { UserRowActions } from "../../../../users/user-row-actions"

export default async function BranchDetailPage({ params }: { params: Promise<{ id: string; branchId: string }> }) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (session.user.role !== "HOLDING_ADMIN") {
    redirect("/console/clinics")
  }

  const { id: clinicId, branchId } = await params
  const actor: AbilitySubject = {
    id: session.user.id,
    role: session.user.role,
    branchId: session.user.branchId,
    holdingCompanyId: session.user.holdingCompanyId,
  }
  const clinic = await getClinicById(actor, clinicId)
  if (!clinic) notFound()
  const branch = await getBranchById(actor, branchId)
  if (!branch || branch.clinicId !== clinicId) notFound()
  const staff = await listUsersForBranch(actor, branchId)

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-heading font-semibold">{branch.name}</h1>
      <p className="text-sm text-muted-foreground">
        {clinic.name} · /{branch.slug} · {branch.city}
        {!branch.isActive && <span className="ml-2 text-destructive">Inactive</span>}
      </p>

      <div className="mt-4">
        <EditBranchForm clinicId={clinicId} branch={branch} />
      </div>

      <div className="mt-6 border-t border-border pt-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase text-muted-foreground">Staff</p>
          <Button asChild size="sm">
            <Link href={`/console/users/new?branchId=${branch.id}`}>Add user</Link>
          </Button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Everyone assigned to this branch. A user works at exactly one branch — move someone by opening their
          account and changing its branch.
        </p>

        <ul className="mt-2 divide-y divide-border rounded-md border border-border">
          {staff.map((u) => (
            <li key={u.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <Link href={`/console/users/${u.id}`} className="font-medium hover:underline">
                  {u.name}
                </Link>
                {!u.isActive && <span className="ml-2 text-xs text-destructive">Inactive</span>}
                {u.isLockedOut && <span className="ml-2 text-xs text-destructive">Locked out</span>}
                <p className="truncate text-xs text-muted-foreground">
                  {u.email} · {ROLE_LABEL[u.role]}
                </p>
              </div>
              <UserRowActions userId={u.id} isActive={u.isActive} isLockedOut={u.isLockedOut} />
            </li>
          ))}
          {staff.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-muted-foreground">No staff at this branch yet.</li>
          )}
        </ul>
      </div>

      <div className="mt-6 border-t border-border pt-4">
        <BranchDetailActions clinicId={clinicId} branchId={branch.id} isActive={branch.isActive} />
      </div>
    </div>
  )
}
