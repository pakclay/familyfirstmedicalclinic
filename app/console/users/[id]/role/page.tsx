import { redirect, notFound } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { prisma } from "@/lib/db/prisma"
import { getManagedUserById } from "@/lib/queries/users"
import { ROLE_PROFILES } from "@/lib/permissions/role-capabilities"
import { ROLE_LABEL } from "@/lib/dto/user"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { ChangeRoleForm } from "./change-role-form"

export default async function ChangeRolePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  // Holding admin only, and refused in place rather than redirected — a
  // clinic admin following a link here should be told why, not bounced.
  if (session.user.role !== "HOLDING_ADMIN") {
    return (
      <div>
        <h1 className="text-2xl font-heading font-semibold">Change role</h1>
        <p className="mt-2 text-sm text-muted-foreground">Only a holding admin can change someone&rsquo;s role.</p>
      </div>
    )
  }

  const { id } = await params
  const actor: AbilitySubject = {
    id: session.user.id,
    role: session.user.role,
    branchId: session.user.branchId,
    holdingCompanyId: session.user.holdingCompanyId,
  }
  const managedUser = await getManagedUserById(actor, id)
  if (!managedUser) notFound()

  const branches = await prisma.branch.findMany({
    where: { isActive: true, clinic: { holdingCompanyId: session.user.holdingCompanyId ?? "" } },
    select: { id: true, name: true, clinic: { select: { name: true } } },
    orderBy: [{ clinic: { name: "asc" } }, { name: "asc" }],
  })

  const isSelf = managedUser.id === actor.id

  return (
    <div className="mx-auto max-w-3xl">
      <p className="text-sm text-muted-foreground">
        <Link href={`/console/users/${id}`} className="hover:underline">
          ← {managedUser.name}
        </Link>
      </p>
      <h1 className="mt-1 text-2xl font-heading font-semibold">Change role</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {managedUser.email} · currently <strong>{ROLE_LABEL[managedUser.role]}</strong>
        {managedUser.branchName ? ` at ${managedUser.branchName}` : " · not attached to a branch"}
      </p>

      {isSelf ? (
        <p className="mt-6 rounded-md border border-border px-4 py-3 text-sm text-muted-foreground">
          This is your own account. Changing your own role is refused — the moment it took effect you would no longer
          be able to reach this page to undo it. Ask another holding admin.
        </p>
      ) : (
        <div className="mt-6">
          <ChangeRoleForm
            userId={managedUser.id}
            userName={managedUser.name}
            currentRole={managedUser.role}
            currentBranchId={managedUser.branchId}
            hasDoctorRecord={managedUser.doctor !== null}
            branches={branches}
          />
        </div>
      )}

      <section className="mt-8">
        <p className="text-xs font-medium uppercase text-muted-foreground">What each role can do</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Every line below is enforced in the query layer, not in this page — the file named against each one is what
          actually refuses.
        </p>
        <div className="mt-3 space-y-3">
          {ROLE_PROFILES.map((p) => (
            <div
              key={p.role}
              className={`rounded-md border px-4 py-3 ${
                p.role === managedUser.role ? "border-brand" : "border-border"
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-medium">
                  {p.label}
                  {p.role === managedUser.role && <span className="ml-2 text-xs text-brand">current</span>}
                </h2>
                <span className="text-xs text-muted-foreground">
                  {p.scope === "company" ? "whole company" : "one branch"} · {p.sections.join(" ")}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{p.summary}</p>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-medium">Can</p>
                  <ul className="mt-1 space-y-1">
                    {p.can.map((c) => (
                      <li key={c.label} className="text-xs text-muted-foreground">
                        {c.label}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-medium">Cannot</p>
                  <ul className="mt-1 space-y-1">
                    {p.cannot.map((c) => (
                      <li key={c.label} className="text-xs text-muted-foreground">
                        {c.label}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
