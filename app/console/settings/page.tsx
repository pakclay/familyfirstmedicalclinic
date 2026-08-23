import { redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { getOwnClinic } from "@/lib/queries/clinics"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { ClinicSettingsForm } from "./clinic-settings-form"

export default async function ClinicSettingsPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  // A holding admin isn't refused for lack of privilege — they have more
  // than enough. They just have no single clinic of their own, so point
  // them at the surface that does let them edit any of them.
  if (session.user.role === "HOLDING_ADMIN") {
    return (
      <div>
        <h1 className="text-2xl font-heading font-semibold">Clinic settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your account isn&rsquo;t attached to a single clinic. Edit any clinic from{" "}
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
    clinicId: session.user.clinicId,
    holdingCompanyId: session.user.holdingCompanyId,
  }
  const clinic = await getOwnClinic(user)

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-heading font-semibold">{clinic.name}</h1>
      <p className="text-sm text-muted-foreground">
        /{clinic.slug} · {clinic.timezone}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        The clinic&rsquo;s name, URL slug and timezone are managed by the holding admin.
      </p>

      <div className="mt-4">
        <ClinicSettingsForm clinic={clinic} />
      </div>
    </div>
  )
}
