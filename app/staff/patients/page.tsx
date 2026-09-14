import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { listPatients } from "@/lib/queries/patients"
import { listTodayQueue, OPEN_STATUSES, type StaffQueueEntryDTO } from "@/lib/queries/queue"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { firstParam, type SearchParam } from "@/lib/utils/search-params"
import { AddToQueue } from "./add-to-queue"

/** What a row says instead of offering "Add to queue": where in today's queue the patient already is. */
const IN_QUEUE_LABEL: Record<string, string> = {
  BOOKED: "Booked · check in on the board",
  CHECKED_IN: "Checked in",
  WAITING: "Waiting",
  CALLED: "Called",
  IN_CONSULTATION: "In consultation",
}

export default async function StaffPatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: SearchParam }>
}) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (session.user.role === "HOLDING_ADMIN") {
    return (
      <div>
        <h1 className="text-2xl font-heading font-semibold">Patients</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A holding admin isn&apos;t scoped to one clinic — patient search is per clinic. This screen is
          for front desk and branch admins.
        </p>
      </div>
    )
  }

  const q = firstParam((await searchParams).q)
  const user: AbilitySubject = {
    id: session.user.id,
    role: session.user.role,
    branchId: session.user.branchId,
    clinicId: session.user.clinicId,
    holdingCompanyId: session.user.holdingCompanyId,
  }
  const [patients, todayQueue] = await Promise.all([listPatients(user, { search: q }), listTodayQueue(user)])

  // One open entry per patient per day is what checkInExistingPatient
  // enforces; knowing it here lets the row show that number instead of a
  // button that would only be refused. Entries come lowest number first.
  const inQueue = new Map<string, StaffQueueEntryDTO>()
  for (const entry of todayQueue) {
    if (OPEN_STATUSES.includes(entry.status) && !inQueue.has(entry.patientId)) inQueue.set(entry.patientId, entry)
  }

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
        {patients.map((p) => {
          const entry = inQueue.get(p.id)
          return (
            <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <Link
                prefetch={false}
                href={`/staff/patients/${p.id}`}
                className="min-w-0 flex-1 hover:underline underline-offset-4"
              >
                <span className="block">
                  {p.lastName}, {p.firstName}
                  {p.isMinor && <span className="ml-2 text-xs text-priority">Minor</span>}
                </span>
                {/* Phone and age are both shown: two real people can share a
                    name and the number is what tells them apart at the counter. */}
                <span className="block font-numeric text-xs text-muted-foreground">
                  {p.age}y · {p.phone}
                </span>
              </Link>
              <AddToQueue
                patient={{ id: p.id, firstName: p.firstName, lastName: p.lastName, age: p.age, phone: p.phone }}
                inQueue={entry ? { queueNumber: entry.queueNumber, label: IN_QUEUE_LABEL[entry.status] } : null}
              />
            </li>
          )
        })}
        {patients.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">
            {q ? "No patients match that search." : "No patients yet."}
          </li>
        )}
      </ul>
    </div>
  )
}
