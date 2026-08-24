import { redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { getOwnBranch } from "@/lib/queries/branches"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { BranchSettingsForm } from "./branch-settings-form"

export default async function ClinicSettingsPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  // A holding admin isn't refused for lack of privilege — they have more
  // than enough. They just have no single branch of their own, so point
  // them at the surface that does let them edit any of them.
  if (session.user.role === "HOLDING_ADMIN") {
    return (
      <div>
        <h1 className="text-2xl font-heading font-semibold">Clinic settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your account isn&rsquo;t attached to a single branch. Edit any clinic or branch from{" "}
          <Link href="/console/clinics" className="underline">
            Clinics
          </Link>
          .
        </p>
      </div>
    )
  }

  if (session.user.role !== "CLINIC_ADMIN") {
    return (
      <div>
        <h1 className="text-2xl font-heading font-semibold">Clinic settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">Only a clinic admin changes clinic settings.</p>
      </div>
    )
  }

  const user: AbilitySubject = {
    id: session.user.id,
    role: session.user.role,
    branchId: session.user.branchId,
    holdingCompanyId: session.user.holdingCompanyId,
  }
  const branch = await getOwnBranch(user)

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-heading font-semibold">{branch.name}</h1>
      <p className="text-sm text-muted-foreground">
        {branch.clinicName} · /{branch.slug} · {branch.timezone}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        The branch&rsquo;s name, URL slug and timezone are managed by the holding admin.
      </p>

      <div className="mt-4">
        <BranchSettingsForm branch={branch} />
      </div>
    </div>
  )
}
