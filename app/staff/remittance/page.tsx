import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getMyRemittanceStatus, listPendingRemittances } from "@/lib/queries/remittance"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { RemittanceForm } from "./remittance-form"
import { PendingRemittanceList } from "./pending-list"

export default async function RemittancePage() {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (session.user.role === "HOLDING_ADMIN") {
    return (
      <div>
        <h1 className="text-2xl font-heading font-semibold">Remittance</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A holding admin isn&apos;t scoped to one clinic — remittance is per clinic.
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
  const status = await getMyRemittanceStatus(user)
  const pending = session.user.role === "CLINIC_ADMIN" ? await listPendingRemittances(user) : null

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-heading font-semibold">Remittance</h1>

      <div className="mt-4 rounded-md border border-border p-4">
        <p className="text-sm text-muted-foreground">Your recorded collections today</p>
        <p className="font-numeric text-3xl font-bold text-brand">₱{(status.expectedAmount / 100).toFixed(2)}</p>

        {status.alreadySubmitted ? (
          <div className="mt-3 text-sm">
            <p>
              Submitted: ₱{(status.alreadySubmitted.actualAmount / 100).toFixed(2)} handed over ·{" "}
              <span className={status.alreadySubmitted.variance === 0 ? "" : status.alreadySubmitted.variance > 0 ? "text-brand" : "text-destructive"}>
                {status.alreadySubmitted.variance > 0 ? "+" : ""}
                ₱{(status.alreadySubmitted.variance / 100).toFixed(2)} variance
              </span>
            </p>
            <p className="text-muted-foreground">{status.alreadySubmitted.confirmed ? "Confirmed by clinic admin." : "Awaiting confirmation."}</p>
          </div>
        ) : (
          <div className="mt-3">
            <RemittanceForm expectedAmount={status.expectedAmount} />
          </div>
        )}
      </div>

      {pending && (
        <div className="mt-8">
          <h2 className="mb-2 text-lg font-heading font-semibold">Pending confirmation</h2>
          <PendingRemittanceList items={pending} />
        </div>
      )}
    </div>
  )
}
