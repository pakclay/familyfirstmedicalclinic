import { runWithRls } from "@/lib/db/rls"
import { requireBranchId, type AbilitySubject } from "@/lib/permissions/ability"

export type DoctorOption = { id: string; name: string; specialization: string }

/** Doctors in the acting user's own branch — for the "Assign Doctor" picker on the staff queue board. */
export async function listBranchDoctors(user: AbilitySubject): Promise<DoctorOption[]> {
  const branchId = requireBranchId(user)
  return runWithRls(user, async (tx) => {
    const doctors = await tx.doctor.findMany({
      where: { branchId },
      include: { user: { select: { name: true } } },
      orderBy: { user: { name: "asc" } },
    })
    return doctors.map((d) => ({ id: d.id, name: d.user.name, specialization: d.specialization }))
  })
}
