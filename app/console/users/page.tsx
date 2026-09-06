import { redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { listUsers } from "@/lib/queries/users"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { UserRowActions } from "./user-row-actions"
import { ROLE_LABEL } from "@/lib/dto/user"

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>
}) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (session.user.role !== "HOLDING_ADMIN" && session.user.role !== "BRANCH_ADMIN" && session.user.role !== "CLINIC_ADMIN") {
    return (
      <div>
        <h1 className="text-2xl font-heading font-semibold">Users</h1>
        <p className="mt-2 text-sm text-muted-foreground">Only an admin manages users.</p>
      </div>
    )
  }

  const user: AbilitySubject = {
    id: session.user.id,
    role: session.user.role,
    branchId: session.user.branchId,
    clinicId: session.user.clinicId,
    holdingCompanyId: session.user.holdingCompanyId,
  }
  // Next resolves a repeated key (?q=a&q=b) to an array, so `q` is not a
  // string just because the form only ever submits one. Everything
  // downstream assumes it is — listUsers trims it, the input takes it as a
  // defaultValue — so a hand-edited URL would throw inside the render and
  // show the error boundary instead of the list. Take the first value.
  const { q: rawQ } = await searchParams
  const q = Array.isArray(rawQ) ? rawQ[0] : rawQ
  const users = await listUsers(user, { search: q })

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-heading font-semibold">Users</h1>
        <Button asChild>
          <Link href="/console/users/new">Add user</Link>
        </Button>
      </div>

      <form className="mt-4 flex gap-2" action="/console/users">
        <Input name="q" type="search" placeholder="Search by name, email or branch" defaultValue={q ?? ""} className="h-10" />
        <Button type="submit" variant="secondary" className="h-10">
          Search
        </Button>
      </form>

      <ul className="mt-4 divide-y divide-border rounded-md border border-border">
        {users.map((u) => (
          <li key={u.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <Link prefetch={false} href={`/console/users/${u.id}`} className="font-medium hover:underline">
                {u.name}
              </Link>
              {!u.isActive && <span className="ml-2 text-xs text-destructive">Inactive</span>}
              {u.isLockedOut && <span className="ml-2 text-xs text-destructive">Locked out</span>}
              <p className="truncate text-xs text-muted-foreground">
                {u.email} · {ROLE_LABEL[u.role]}
                {u.branchName ? ` · ${u.branchName}` : ""}
              </p>
            </div>
            <UserRowActions userId={u.id} isActive={u.isActive} isLockedOut={u.isLockedOut} />
          </li>
        ))}
        {users.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">
            {q ? "No users match that search." : "No users yet."}
          </li>
        )}
      </ul>
    </div>
  )
}
