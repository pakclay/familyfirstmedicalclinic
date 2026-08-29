import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { listMedicines } from "@/lib/queries/inventory"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { PhysicalCountForm } from "./physical-count-form"

export default async function PhysicalCountPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (session.user.role === "HOLDING_ADMIN" || session.user.role === "DOCTOR") redirect("/staff/inventory")

  const user: AbilitySubject = {
    id: session.user.id,
    role: session.user.role,
    branchId: session.user.branchId,
    holdingCompanyId: session.user.holdingCompanyId,
  }
  const medicines = await listMedicines(user)

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-heading font-semibold">Physical count</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Enter what you actually counted — leave a medicine blank to skip it this time.
      </p>
      <div className="mt-4">
        <PhysicalCountForm medicines={medicines} />
      </div>
    </div>
  )
}
