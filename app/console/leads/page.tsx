import { requireRole } from "@/lib/auth/guards"
import { ComingSoon } from "@/components/console/coming-soon"

export default async function LeadsPage() {
  await requireRole(["OWNER", "BRANCH_MANAGER", "FRONT_DESK", "MARKETING"])
  return (
    <ComingSoon
      title="Leads"
      phase="Phase 6"
      note="Kanban by stage, Meta Lead Ads webhook + CSV import, automatic follow-up queue."
    />
  )
}
