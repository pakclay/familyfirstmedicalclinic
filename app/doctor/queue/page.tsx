import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { listDoctorQueue } from "@/lib/queries/queue"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { DoctorQueueList } from "./doctor-queue-list"

export default async function DoctorQueuePage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const user: AbilitySubject = {
    id: session.user.id,
    role: session.user.role,
    clinicId: session.user.clinicId,
    holdingCompanyId: session.user.holdingCompanyId,
  }
  const entries = await listDoctorQueue(user)

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-heading font-semibold">My queue</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Patients assigned to you, waiting or in progress today.
      </p>
      <div className="mt-4">
        <DoctorQueueList initialEntries={entries} />
      </div>
    </div>
  )
}
