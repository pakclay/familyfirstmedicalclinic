import { requireRole } from "@/lib/auth/guards"
import { ComingSoon } from "@/components/console/coming-soon"

export default async function SettingsPage() {
  await requireRole(["OWNER"])
  return (
    <ComingSoon
      title="Settings"
      phase="later phases"
      note="Users & access control, quota schemes, follow-up thresholds, branches & services catalog, retention policy."
    />
  )
}
