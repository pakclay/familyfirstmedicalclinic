import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getMyRemittanceStatus } from "@/lib/queries/remittance"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { RemittanceForm } from "@/app/staff/remittance/remittance-form"

// §1: "today doctors take cash directly" — a doctor is as much a
// "collector" under §7.7 as front desk is, so this reuses the exact same
// form/query as /staff/remittance rather than reimplementing it. It lives
// under /doctor because middleware's /staff/* gate is otherwise reserved
// for front desk/clinic admin/holding admin screens.
export default async function DoctorRemittancePage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const user: AbilitySubject = {
    id: session.user.id,
    role: session.user.role,
    clinicId: session.user.clinicId,
    holdingCompanyId: session.user.holdingCompanyId,
  }
  const status = await getMyRemittanceStatus(user)

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
    </div>
  )
}
