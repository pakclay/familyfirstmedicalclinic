import { requireRole } from "@/lib/auth/guards"
import { ComingSoon } from "@/components/console/coming-soon"

export default async function TherapistsPage() {
  await requireRole(["OWNER", "BRANCH_MANAGER", "FRONT_DESK"])
  return <ComingSoon title="Therapists" phase="Phase 3" note="Roster, specialties, availability, booking eligibility." />
}
