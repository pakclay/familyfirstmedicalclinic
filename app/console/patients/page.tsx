import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { listPatients } from "@/lib/queries/patients"
import type { AbilitySubject } from "@/lib/permissions/ability"

export default async function PatientsPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const user: AbilitySubject = {
    id: session.user.id,
    role: session.user.role,
    clinicId: session.user.clinicId,
    holdingCompanyId: session.user.holdingCompanyId,
  }

  if (user.role === "HOLDING_ADMIN") {
    return (
      <div>
        <h1 className="text-2xl font-heading font-semibold">Patients</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Pick a clinic from the Clinics page to browse its patients — a holding admin isn&apos;t scoped
          to one clinic, so this list needs an explicit clinic first.
        </p>
      </div>
    )
  }

  const patients = await listPatients(user)

  return (
    <div>
      <h1 className="text-2xl font-heading font-semibold">Patients</h1>
      <ul className="mt-4 divide-y divide-border rounded-md border border-border">
        {patients.map((p) => (
          <li key={p.id}>
            <Link href={`/console/patients/${p.id}`} className="flex justify-between px-4 py-3 text-sm hover:bg-accent">
              <span>
                {p.lastName}, {p.firstName}
              </span>
              <span className="font-numeric text-muted-foreground">{p.age}y · {p.phone}</span>
            </Link>
          </li>
        ))}
        {patients.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">No patients yet.</li>
        )}
      </ul>
    </div>
  )
}
