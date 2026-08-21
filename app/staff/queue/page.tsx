import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { listTodayQueue } from "@/lib/queries/queue"
import { listClinicDoctors } from "@/lib/queries/doctors"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { QueueBoard } from "./queue-board"

export default async function StaffQueuePage() {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (session.user.role === "HOLDING_ADMIN") {
    return (
      <div>
        <h1 className="text-2xl font-heading font-semibold">Queue board</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A holding admin isn&apos;t scoped to one clinic — the queue board is per clinic.
        </p>
      </div>
    )
  }

  const user: AbilitySubject = {
    id: session.user.id,
    role: session.user.role,
    clinicId: session.user.clinicId,
    holdingCompanyId: session.user.holdingCompanyId,
  }
  const [entries, doctors] = await Promise.all([listTodayQueue(user), listClinicDoctors(user)])

  return <QueueBoard initialEntries={entries} doctors={doctors} />
}
