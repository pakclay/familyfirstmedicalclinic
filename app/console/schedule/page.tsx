import { requireRole } from "@/lib/auth/guards"
import { ComingSoon } from "@/components/console/coming-soon"

export default async function SchedulePage() {
  await requireRole(["OWNER", "BRANCH_MANAGER", "DOCTOR", "THERAPIST", "FRONT_DESK"])
  return (
    <ComingSoon
      title="Schedule"
      phase="Phase 3"
      note="Therapist availability, day/week calendar, book/check-in/complete/no-show, package credits."
    />
  )
}
