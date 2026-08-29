import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { listPatients } from "@/lib/queries/patients"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

export default async function StaffPatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (session.user.role === "HOLDING_ADMIN") {
    return (
      <div>
        <h1 className="text-2xl font-heading font-semibold">Patients</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A holding admin isn&apos;t scoped to one clinic — patient search is per clinic. This screen is
          for front desk and clinic admins.
        </p>
      </div>
    )
  }

  const { q } = await searchParams
  const user: AbilitySubject = {
    id: session.user.id,
    role: session.user.role,
    branchId: session.user.branchId,
    holdingCompanyId: session.user.holdingCompanyId,
  }
  const patients = await listPatients(user, { search: q })

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-heading font-semibold">Patients</h1>
      <form className="mt-4 flex gap-2" action="/staff/patients">
        <Input name="q" placeholder="Search by name or phone" defaultValue={q ?? ""} className="h-11" />
        <Button type="submit" className="h-11">
          Search
        </Button>
      </form>

      <ul className="mt-4 divide-y divide-border rounded-md border border-border">
        {patients.map((p) => (
          <li key={p.id}>
            <Link
              href={`/staff/patients/${p.id}`}
              className="flex items-center justify-between px-4 py-3 text-sm hover:bg-accent"
            >
              <span>
                {p.lastName}, {p.firstName}
                {p.isMinor && <span className="ml-2 text-xs text-priority">Minor</span>}
              </span>
              <span className="font-numeric text-muted-foreground">
                {p.age}y · {p.phone}
              </span>
            </Link>
          </li>
        ))}
        {patients.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">
            {q ? "No patients match that search." : "No patients yet."}
          </li>
        )}
      </ul>
    </div>
  )
}
