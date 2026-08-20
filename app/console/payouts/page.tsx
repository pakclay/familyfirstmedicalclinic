import { requireRole } from "@/lib/auth/guards"
import { ComingSoon } from "@/components/console/coming-soon"

export default async function PayoutsPage() {
  await requireRole(["OWNER", "BRANCH_MANAGER", "THERAPIST"])
  return (
    <ComingSoon
      title="Payouts"
      phase="Phase 5"
      note="Quota engine, tier progress, approval flow, payroll export. Therapists see only their own numbers."
    />
  )
}
