import { runWithRls } from "@/lib/db/rls"
import { requireBranchId, type AbilitySubject } from "@/lib/permissions/ability"

export type DoctorOption = { id: string; name: string; specialization: string }

/** Doctors in the acting user's own branch — for the "Assign Doctor" picker on the staff queue board. */
export async function listBranchDoctors(user: AbilitySubject): Promise<DoctorOption[]> {
  const branchId = requireBranchId(user)
  return runWithRls(user, async (tx) => {
    // Filtered on the *user* as well as the branch. A Doctor row outlives
    // the role: it is never deleted on demotion, because consultations
    // reference it with a NOT NULL column, so a demoted or deactivated
    // account keeps its row and would otherwise stay pickable here — the
    // queue would offer a doctor who can no longer open a consultation.
    const doctors = await tx.doctor.findMany({
      where: { branchId, user: { isActive: true, role: "DOCTOR" } },
      include: { user: { select: { name: true } } },
      orderBy: { user: { name: "asc" } },
    })
    return doctors.map((d) => ({ id: d.id, name: d.user.name, specialization: d.specialization }))
  })
}
