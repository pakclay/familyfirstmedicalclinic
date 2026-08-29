import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { listUsersForBranch } from "@/lib/queries/users"
import { ROLE_LABEL } from "@/lib/dto/user"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { Button } from "@/components/ui/button"
import { UserRowActions } from "@/app/console/users/user-row-actions"

/**
 * A clinic admin's own branch roster.
 *
 * §4 gives a clinic admin their branch's front desk and doctor accounts, but
 * the only screen that listed accounts was /console/users, which is now
 * reachable only through Administration and the clinic pages — all of them
 * holding-admin only. The permission existed with no door. This is the door,
 * scoped to the one branch they actually run.
 *
 * Deliberately not a second user-management implementation: rows link into
 * the existing /console/users/[id] editor and "Add someone" into
 * /console/users/new, both of which already admit a clinic admin and already
 * confine them to their own branch. This page only answers "who works here".
 */
export default async function StaffTeamPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  // Front desk can see the queue and the patients, not the payroll. A holding
  // admin has Administration, which spans every branch rather than one.
  // Refused in place rather than redirected — this is a nav destination, and
  // bouncing someone makes a deliberate boundary look like a broken link.
  if (session.user.role !== "CLINIC_ADMIN") {
    return (
      <div>
        <h1 className="text-2xl font-heading font-semibold">Team</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {session.user.role === "HOLDING_ADMIN"
            ? "A holding admin isn't attached to one branch — see Administration for every clinic's staff."
            : "Only a clinic admin manages the accounts at this branch."}
        </p>
      </div>
    )
  }

  const user: AbilitySubject = {
    id: session.user.id,
    role: session.user.role,
    branchId: session.user.branchId,
    holdingCompanyId: session.user.holdingCompanyId,
  }

  // Every clinic admin is seeded with a branch, but a null here would throw
  // from requireBranchId as a 500 rather than say anything useful.
  if (!user.branchId) {
    return (
      <div>
        <h1 className="text-2xl font-heading font-semibold">Team</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This account isn&apos;t attached to a branch yet, so it has no team to show.
        </p>
      </div>
    )
  }

  const team = await listUsersForBranch(user, user.branchId)

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-heading font-semibold">Team</h1>
        <Button asChild size="sm">
          <Link href={`/console/users/new?branchId=${user.branchId}`}>Add someone</Link>
        </Button>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Front desk and doctors at this branch. Open an account to edit it, reset its password, or deactivate it.
      </p>

      <ul className="mt-4 divide-y divide-border rounded-md border border-border">
        {team.map((u) => (
          <li key={u.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <Link href={`/console/users/${u.id}`} className="text-sm font-medium hover:underline">
                {u.name}
              </Link>
              {!u.isActive && <span className="ml-2 text-xs text-destructive">Inactive</span>}
              {u.isLockedOut && <span className="ml-2 text-xs text-destructive">Locked out</span>}
              {u.mustChangePassword && u.isActive && (
                <span className="ml-2 text-xs text-signal">Hasn&rsquo;t set a password</span>
              )}
              <p className="truncate text-xs text-muted-foreground">
                {u.email} · {ROLE_LABEL[u.role]}
              </p>
            </div>
            <UserRowActions userId={u.id} isActive={u.isActive} isLockedOut={u.isLockedOut} />
          </li>
        ))}
        {team.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">
            Nobody else at this branch yet.
          </li>
        )}
      </ul>
    </div>
  )
}
