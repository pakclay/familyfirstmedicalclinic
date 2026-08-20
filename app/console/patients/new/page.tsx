import { requireRole } from "@/lib/auth/guards"
import { prisma } from "@/lib/db/prisma"
import { NewPatientForm } from "./new-patient-form"

export default async function NewPatientPage() {
  const user = await requireRole(["OWNER", "BRANCH_MANAGER", "FRONT_DESK"])

  const branches =
    user.role === "OWNER"
      ? await prisma.branch.findMany({ where: { isActive: true }, orderBy: { name: "asc" } })
      : await prisma.branch.findMany({ where: { id: user.homeBranchId ?? "__none__" } })

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Add patient</h1>
        <p className="text-sm text-muted-foreground">For a walk-in, or filling in the form on a client&apos;s behalf.</p>
      </div>
      <NewPatientForm branches={branches.map((b) => ({ id: b.id, name: b.name }))} />
    </div>
  )
}
