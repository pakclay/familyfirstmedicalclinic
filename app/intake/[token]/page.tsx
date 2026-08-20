import { notFound } from "next/navigation"
import { getActiveBranchByCode } from "@/lib/actions/intake"
import { IntakePublicForm } from "./intake-public-form"

// Phase 1 interprets the spec's `/intake/[token]` route with the branch
// code as the token — a per-branch kiosk/QR link. Once booking (Phase 7)
// exists, a per-booking token can extend this same page. See DECISIONS.md.
export default async function PublicIntakePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const branch = await getActiveBranchByCode(token)
  if (!branch) notFound()

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-6 text-center">
        <p className="font-heading text-xl font-bold tracking-tight">Stretch Lab PH</p>
        <p className="text-sm text-muted-foreground">Intake form — {branch.name}</p>
      </div>
      <IntakePublicForm branchCode={branch.code} />
    </div>
  )
}
