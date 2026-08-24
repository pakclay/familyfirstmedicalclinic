import { redirect, notFound } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { getClinicById } from "@/lib/queries/clinics"
import { listBranches } from "@/lib/queries/branches"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { Button } from "@/components/ui/button"
import { EditClinicForm } from "./edit-clinic-form"
import { BranchRowActions } from "./branch-row-actions"

export default async function ClinicDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (session.user.role !== "HOLDING_ADMIN") {
    redirect("/console/clinics")
  }

  const { id } = await params
  const actor: AbilitySubject = {
    id: session.user.id,
    role: session.user.role,
    branchId: session.user.branchId,
    holdingCompanyId: session.user.holdingCompanyId,
  }
  const clinic = await getClinicById(actor, id)
  if (!clinic) notFound()
  const branches = await listBranches(actor, { clinicId: id })

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-heading font-semibold">{clinic.name}</h1>

      <div className="mt-4">
        <EditClinicForm clinic={clinic} />
      </div>

      <div className="mt-6 border-t border-border pt-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase text-muted-foreground">Branches</p>
          <Button asChild size="sm">
            <Link href={`/console/clinics/${id}/branches/new`}>Add branch</Link>
          </Button>
        </div>

        <ul className="mt-2 divide-y divide-border rounded-md border border-border">
          {branches.map((b) => (
            <li key={b.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <Link href={`/console/clinics/${id}/branches/${b.id}`} className="font-medium hover:underline">
                  {b.name}
                </Link>
                {!b.isActive && <span className="ml-2 text-xs text-destructive">Inactive</span>}
                <p className="truncate text-xs text-muted-foreground">
                  /{b.slug} · {b.city} · {b.phone}
                </p>
              </div>
              <BranchRowActions clinicId={id} branchId={b.id} isActive={b.isActive} />
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
