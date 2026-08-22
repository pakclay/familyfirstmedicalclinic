import { runWithRls } from "@/lib/db/rls"
import { requireClinicId, type AbilitySubject } from "@/lib/permissions/ability"
import { ForbiddenError } from "@/lib/permissions/errors"
import { toPatientDTO, type PatientDTO } from "@/lib/dto/patient"
import type { ConsultationSummaryDTO } from "@/lib/dto/consultation"
import { toMedicineOptionDTO, type MedicineOptionDTO } from "@/lib/dto/medicine"
import { consultationSchema } from "@/lib/validation/consultation"

/** Everything the consultation screen needs in one fetch: the patient, their prior history, and live stock. */
export type ConsultationScreenData = {
  queueEntryId: string
  queueNumber: number
  priority: "NORMAL" | "PRIORITY"
  reasonForVisit: string | null
  patient: PatientDTO
  history: ConsultationSummaryDTO[]
  medicines: MedicineOptionDTO[]
  consultationFee: number
}

export async function getConsultationScreenData(
  user: AbilitySubject,
  queueEntryId: string
): Promise<ConsultationScreenData> {
  if (user.role !== "DOCTOR") throw new ForbiddenError("Only doctors open the consultation screen")
  const clinicId = requireClinicId(user)

  return runWithRls(user, async (tx) => {
    const doctor = await tx.doctor.findUnique({ where: { userId: user.id } })
    if (!doctor) throw new ForbiddenError("No doctor profile for this account")

    const entry = await tx.queueEntry.findFirst({
      where: { id: queueEntryId, clinicId },
      include: { patient: true },
    })
    if (!entry) throw new ForbiddenError("Queue entry not found in your clinic")
    if (entry.doctorId !== doctor.id) throw new ForbiddenError("This patient isn't assigned to you")
    if (entry.status !== "CALLED" && entry.status !== "IN_CONSULTATION") {
      throw new Error(`Cannot open a consultation for a queue entry with status ${entry.status}`)
    }

    const priorConsultations = await tx.consultation.findMany({
      where: { patientId: entry.patientId, deletedAt: null },
      include: {
        doctor: { include: { user: { select: { name: true } } } },
        medicinesDispensed: { where: { deletedAt: null } },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    })

    const medicines = await tx.medicine.findMany({
      where: { clinicId, isActive: true, OR: [{ expiryDate: null }, { expiryDate: { gte: new Date() } }] },
      orderBy: { name: "asc" },
    })

    return {
      queueEntryId: entry.id,
      queueNumber: entry.queueNumber,
      priority: entry.priority,
      reasonForVisit: entry.reasonForVisit,
      patient: toPatientDTO(entry.patient),
      history: priorConsultations.map((c) => ({
        id: c.id,
        queueEntryId: c.queueEntryId,
        date: c.createdAt,
        doctorName: c.doctor.user.name,
        chiefComplaint: c.chiefComplaint,
        diagnosis: c.diagnosis,
        followUpDate: c.followUpDate,
        medicines: c.medicinesDispensed.map((md) => ({
          id: md.id,
          medicineName: md.medicineName,
          dosage: md.dosage,
          quantity: md.quantity,
          instructions: md.instructions,
          dispensedFromStock: md.stockMovementId !== null,
        })),
      })),
      medicines: medicines.map(toMedicineOptionDTO),
      consultationFee: doctor.consultationFee,
    }
  })
}

/** A patient's consultation history — used by both the consultation screen and the patient profile page. */
export async function listPatientConsultationHistory(
  user: AbilitySubject,
  patientId: string
): Promise<ConsultationSummaryDTO[]> {
  return runWithRls(user, async (tx) => {
    const consultations = await tx.consultation.findMany({
      where: {
        patientId,
        deletedAt: null,
        ...(user.role === "HOLDING_ADMIN" ? {} : { clinicId: user.clinicId! }),
      },
      include: {
        doctor: { include: { user: { select: { name: true } } } },
        medicinesDispensed: { where: { deletedAt: null } },
      },
      orderBy: { createdAt: "desc" },
      take: 25,
    })
    return consultations.map((c) => ({
      id: c.id,
      queueEntryId: c.queueEntryId,
      date: c.createdAt,
      doctorName: c.doctor.user.name,
      chiefComplaint: c.chiefComplaint,
      diagnosis: c.diagnosis,
      followUpDate: c.followUpDate,
      medicines: c.medicinesDispensed.map((md) => ({
        id: md.id,
        medicineName: md.medicineName,
        dosage: md.dosage,
        quantity: md.quantity,
        instructions: md.instructions,
        dispensedFromStock: md.stockMovementId !== null,
      })),
    }))
  })
}

export class InsufficientStockError extends Error {
  constructor(public shortfalls: { medicineName: string; requested: number; available: number }[]) {
    super(`Insufficient stock: ${shortfalls.map((s) => `${s.medicineName} (${s.available} available, ${s.requested} requested)`).join(", ")}`)
  }
}

/**
 * §7.4/§7.5: saves the consultation, dispenses medicine (deducting stock
 * in the same transaction — a failure anywhere rolls back everything,
 * nothing is half-saved), records the payment, and marks the queue entry
 * completed. An insufficient quantity blocks the save unless
 * `overrideInsufficientStock` is set (§7.5's "dispense anyway" DECISION),
 * in which case it dispenses the full requested amount anyway and the
 * caller writes an audit entry naming who overrode it.
 */
export async function saveConsultation(
  user: AbilitySubject,
  queueEntryId: string,
  input: unknown
): Promise<{ consultationId: string }> {
  if (user.role !== "DOCTOR") throw new ForbiddenError("Only doctors save consultations")
  const clinicId = requireClinicId(user)
  const parsed = consultationSchema.parse(input)

  return runWithRls(user, async (tx) => {
    const doctor = await tx.doctor.findUnique({ where: { userId: user.id } })
    if (!doctor) throw new ForbiddenError("No doctor profile for this account")

    const entry = await tx.queueEntry.findFirst({ where: { id: queueEntryId, clinicId } })
    if (!entry) throw new ForbiddenError("Queue entry not found in your clinic")
    if (entry.doctorId !== doctor.id) throw new ForbiddenError("This patient isn't assigned to you")
    if (entry.status !== "CALLED" && entry.status !== "IN_CONSULTATION") {
      throw new Error(`Cannot save a consultation for a queue entry with status ${entry.status}`)
    }

    // Check every dispensed-from-stock row against a *fresh* read of
    // current stock before touching anything — §7.5: "if the transaction
    // fails, nothing is deducted and nothing is saved."
    const stockRows = parsed.medicines.filter((m) => m.dispensedFromStock && m.medicineId)
    const medicineIds = [...new Set(stockRows.map((m) => m.medicineId!))]
    const medicines = medicineIds.length
      ? await tx.medicine.findMany({ where: { id: { in: medicineIds }, clinicId } })
      : []
    const medicineById = new Map(medicines.map((m) => [m.id, m]))

    const requestedByMedicine = new Map<string, number>()
    for (const row of stockRows) {
      requestedByMedicine.set(row.medicineId!, (requestedByMedicine.get(row.medicineId!) ?? 0) + row.quantity)
    }
    const shortfalls: { medicineName: string; requested: number; available: number }[] = []
    for (const [medicineId, requested] of requestedByMedicine) {
      const medicine = medicineById.get(medicineId)
      if (!medicine || medicine.currentStock < requested) {
        shortfalls.push({
          medicineName: medicine?.name ?? "Unknown medicine",
          requested,
          available: medicine?.currentStock ?? 0,
        })
      }
    }
    if (shortfalls.length > 0 && !parsed.overrideInsufficientStock) {
      throw new InsufficientStockError(shortfalls)
    }
    // §7.5 DECISION: overriding still dispenses the full requested amount
    // (driving current_stock to whatever that leaves — negative if the
    // shelf really was miscounted, which is itself the signal a physical
    // count is due) rather than silently capping at what the system
    // thought was available; the audit trail is what makes the override
    // safe to allow, not a smaller effective quantity.
    const overrodeShortfall = shortfalls.length > 0 && parsed.overrideInsufficientStock

    const consultation = await tx.consultation.create({
      data: {
        queueEntryId,
        patientId: entry.patientId,
        doctorId: doctor.id,
        clinicId,
        chiefComplaint: parsed.chiefComplaint,
        vitals: parsed.vitals ?? undefined,
        findings: parsed.findings || null,
        diagnosis: parsed.diagnosis || null,
        treatmentPlan: parsed.treatmentPlan || null,
        followUpDate: parsed.followUpDate || null,
      },
    })

    // Running balance per medicine, applied in request order — matters
    // when the same medicine appears in more than one row.
    const runningStock = new Map(medicines.map((m) => [m.id, m.currentStock]))

    for (const row of parsed.medicines) {
      let stockMovementId: string | null = null

      if (row.dispensedFromStock && row.medicineId) {
        const before = runningStock.get(row.medicineId)!
        const after = before - row.quantity
        runningStock.set(row.medicineId, after)

        const movement = await tx.stockMovement.create({
          data: {
            clinicId,
            medicineId: row.medicineId,
            movementType: "DISPENSE",
            quantityChange: -row.quantity,
            balanceAfter: after,
            referenceType: "Consultation",
            referenceId: consultation.id,
            performedByUserId: user.id,
          },
        })
        await tx.medicine.update({ where: { id: row.medicineId }, data: { currentStock: after } })
        stockMovementId = movement.id
      }

      const catalogMedicine = row.medicineId ? medicineById.get(row.medicineId) : undefined
      await tx.medicineDispensed.create({
        data: {
          consultationId: consultation.id,
          clinicId,
          medicineId: row.dispensedFromStock ? row.medicineId : null,
          medicineName: row.medicineName,
          dosage: row.dosage || null,
          quantity: row.quantity,
          instructions: row.instructions || null,
          unitPrice: row.dispensedFromStock ? (catalogMedicine?.sellingPrice ?? null) : null,
          stockMovementId,
        },
      })
    }

    const payment = await tx.payment.create({
      data: {
        clinicId,
        consultationId: consultation.id,
        patientId: entry.patientId,
        amount: parsed.payment.amount,
        paymentMethod: parsed.payment.method,
        collectedByUserId: user.id,
        orNumber: parsed.payment.orNumber || null,
        notes: parsed.payment.notes || null,
      },
    })

    await tx.queueEntry.update({ where: { id: queueEntryId }, data: { status: "COMPLETED", completedAt: new Date() } })

    // §10: audit every clinical-data write and every financial-record
    // change. StockMovement rows are their own immutable ledger (already
    // carrying performedByUserId + createdAt) so they aren't duplicated
    // here — Consultation (clinical) and Payment (financial) are the two
    // §10 calls out explicitly.
    await tx.auditLog.create({
      data: { clinicId, userId: user.id, action: "consultation.create", entityType: "Consultation", entityId: consultation.id },
    })
    await tx.auditLog.create({
      data: { clinicId, userId: user.id, action: "payment.create", entityType: "Payment", entityId: payment.id, changes: { amount: payment.amount } },
    })
    if (overrodeShortfall) {
      // §7.5 DECISION: the override "writes an audit log entry naming the
      // user" — a separate, explicit entry from the dispense movements
      // themselves, since this is the one that specifically flags *that a
      // block was bypassed*, not just that stock changed.
      await tx.auditLog.create({
        data: {
          clinicId,
          userId: user.id,
          action: "medicine.dispense_override",
          entityType: "Consultation",
          entityId: consultation.id,
          changes: { shortfalls },
        },
      })
    }

    return { consultationId: consultation.id }
  })
}
