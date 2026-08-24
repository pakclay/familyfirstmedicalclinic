import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { listMyCollectionsToday } from "@/lib/queries/payments"
import type { AbilitySubject } from "@/lib/permissions/ability"

const METHOD_LABEL: Record<string, string> = {
  CASH: "Cash",
  GCASH: "GCash",
  CARD: "Card",
  HMO: "HMO",
  OTHER: "Other",
}

export default async function MyCollectionsPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const user: AbilitySubject = {
    id: session.user.id,
    role: session.user.role,
    branchId: session.user.branchId,
    holdingCompanyId: session.user.holdingCompanyId,
  }
  const { entries, total } = await listMyCollectionsToday(user)

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-heading font-semibold">My collections today</h1>
      <p className="mt-1 font-numeric text-4xl font-bold text-brand">₱{(total / 100).toFixed(2)}</p>

      <ul className="mt-4 divide-y divide-border rounded-md border border-border">
        {entries.map((e) => (
          <li key={e.id} className="flex items-center justify-between px-4 py-3 text-sm">
            <div>
              <p>{e.patientName}</p>
              <p className="text-xs text-muted-foreground">
                {METHOD_LABEL[e.method] ?? e.method} ·{" "}
                {e.receivedAt.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}
              </p>
            </div>
            <span className="font-numeric">₱{(e.amount / 100).toFixed(2)}</span>
          </li>
        ))}
        {entries.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">No collections yet today.</li>
        )}
      </ul>
    </div>
  )
}
