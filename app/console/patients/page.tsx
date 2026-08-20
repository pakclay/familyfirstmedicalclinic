import { requireRole } from "@/lib/auth/guards"
import { ComingSoon } from "@/components/console/coming-soon"

export default async function PatientsPage() {
  await requireRole(["OWNER", "BRANCH_MANAGER", "DOCTOR", "THERAPIST", "FRONT_DESK"])
  return (
    <ComingSoon
      title="Patients"
      phase="Phase 1"
      note="List, search, full profile with timeline, intake form, consent capture, Excel importer."
    />
  )
}
