import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { listDueFollowUps } from "@/lib/queries/notifications"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { FollowUpList } from "./follow-up-list"

export default async function FollowUpsPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (session.user.role === "HOLDING_ADMIN") {
    return (
      <div>
        <h1 className="text-2xl font-heading font-semibold">Follow-ups</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A holding admin isn&apos;t scoped to one clinic — follow-ups are tracked per clinic.
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
  const items = await listDueFollowUps(user)

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-heading font-semibold">Follow-ups</h1>
      <p className="mt-1 text-sm text-muted-foreground">Patients with a follow-up checkup due or overdue.</p>
      <div className="mt-4">
        <FollowUpList items={items} />
      </div>
    </div>
  )
}
