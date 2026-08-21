import { runWithRls } from "@/lib/db/rls"
import { requireClinicId, type AbilitySubject } from "@/lib/permissions/ability"
import { toMedicineOptionDTO, type MedicineOptionDTO } from "@/lib/dto/medicine"

/**
 * The clinic's dispensable catalog for the consultation screen's picker.
 * §7.5: "Expired medicines are excluded from the consultation picker by
 * default" — deactivated (`isActive: false`) medicines are excluded for
 * the same reason (a discontinued item shouldn't be offered for a new
 * dispense, even though old consultation records that already reference it
 * keep reading correctly via the denormalized `medicineName`).
 */
export async function listDispensableMedicines(user: AbilitySubject): Promise<MedicineOptionDTO[]> {
  const clinicId = requireClinicId(user)
  return runWithRls(user, async (tx) => {
    const medicines = await tx.medicine.findMany({
      where: {
        clinicId,
        isActive: true,
        OR: [{ expiryDate: null }, { expiryDate: { gte: new Date() } }],
      },
      orderBy: { name: "asc" },
    })
    return medicines.map(toMedicineOptionDTO)
  })
}
