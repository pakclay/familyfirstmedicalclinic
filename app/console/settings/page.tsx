import Link from "next/link"
import { requireRole } from "@/lib/auth/guards"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export default async function SettingsPage() {
  await requireRole(["OWNER"])
  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-2xl font-bold">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Import patients from Excel/CSV</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Upload your existing spreadsheet, map its columns, dry-run, then commit.</p>
          <Button asChild>
            <Link href="/console/settings/import">Open importer</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Coming later</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Users & access control, quota schemes, follow-up thresholds, branches & services catalog, retention policy.
        </CardContent>
      </Card>
    </div>
  )
}
