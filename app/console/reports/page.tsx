import { requireRole } from "@/lib/auth/guards"
import { ComingSoon } from "@/components/console/coming-soon"

export default async function ReportsPage() {
  await requireRole(["OWNER", "BRANCH_MANAGER", "MARKETING"])
  return (
    <ComingSoon
      title="Reports"
      phase="Phase 8"
      note="Revenue, demographics, retention cohorts, lead funnel. Marketing sees aggregates only, never names."
    />
  )
}
