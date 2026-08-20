import { requireSession } from "@/lib/auth/guards"
import { ROLE_LABELS } from "@/lib/role-labels"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default async function DashboardPage() {
  const user = await requireSession()

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Welcome, {(user.name ?? "there").split(" ")[0]}</h1>
        <p className="text-sm text-muted-foreground">
          Signed in as {ROLE_LABELS[user.role]}. Your sidebar shows only what your role can act on.
        </p>
      </div>
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Phase 0</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Auth, roles, and role-aware navigation are wired up. Patient records, scheduling, quota, CRM,
          and analytics land in the phases that follow — see DECISIONS.md for progress.
        </CardContent>
      </Card>
    </div>
  )
}
