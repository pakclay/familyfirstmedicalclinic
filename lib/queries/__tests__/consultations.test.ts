import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { Role, Sex, MedicineForm, MedicineUnit } from "@prisma/client"
import { superuserPrisma } from "@/lib/test/superuser-prisma"
import { prisma } from "@/lib/db/prisma"
import { saveConsultation, InsufficientStockError, listPatientConsultationHistory } from "@/lib/queries/consultations"
import { listMyCollectionsToday } from "@/lib/queries/payments"
import { todayAsQueueDate } from "@/lib/queries/queue"
import { ForbiddenError } from "@/lib/permissions/errors"
import type { AbilitySubject } from "@/lib/permissions/ability"

/**
 * M4's accept bar (§12): "a completed consultation appears in the
 * patient's history immediately and in today's revenue figure attributed
 * to the correct collector." Also covers §7.5's core dispensing
 * correctness (deducts the right amount, blocks + rolls back on
 * insufficient stock) even though the *override* checkbox is M4b's job.
 */
describe("consultations", () => {
  let clinic: { id: string; timezone: string }
  let doctorUser: AbilitySubject
  let doctorId: string
  let patient: { id: string }
  let stockedMedicine: { id: string; name: string }
  let lowStockMedicine: { id: string }

  async function createQueueEntry(status: "CALLED" | "IN_CONSULTATION" = "CALLED") {
    return superuserPrisma.queueEntry.create({
      data: {
        clinicId: clinic.id,
        patientId: patient.id,
        doctorId,
        queueNumber: Math.floor(Math.random() * 100000) + 1,
        queueDate: todayAsQueueDate(clinic.timezone),
        status,
        source: "WALK_IN",
        checkedInAt: new Date(),
        calledAt: new Date(),
        accessToken: `test-consult-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
    })
  }

  beforeAll(async () => {
    const holding = await superuserPrisma.holdingCompany.create({ data: { name: "Consult Test Holding" } })
    const clinicRow = await superuserPrisma.clinic.create({
      data: {
        holdingCompanyId: holding.id,
        name: "Consult Test Clinic",
        slug: `consult-test-${Date.now()}`,
        address: "1 Test St",
        city: "Test City",
        phone: "0000",
        timezone: "Asia/Manila",
        operatingHours: {},
      },
    })
    clinic = { id: clinicRow.id, timezone: clinicRow.timezone }

    const docUser = await superuserPrisma.user.create({
      data: { clinicId: clinic.id, name: "Dr. Consult", email: `dr-consult-${Date.now()}@test.local`, passwordHash: "x", role: Role.DOCTOR },
    })
    const doctor = await superuserPrisma.doctor.create({
      data: { userId: docUser.id, clinicId: clinic.id, licenseNumber: "C1", consultationFee: 50000 },
    })
    doctorId = doctor.id
    doctorUser = { id: docUser.id, role: Role.DOCTOR, clinicId: clinic.id, holdingCompanyId: null }

    patient = await superuserPrisma.patient.create({
      data: {
        clinicId: clinic.id,
        firstName: "Consult",
        lastName: "Patient",
        birthdate: new Date("1990-01-01"),
        sex: Sex.FEMALE,
        phone: "+63 917 999 0000",
        address: "addr",
        emergencyContactName: "ec",
        emergencyContactPhone: "+63 917 999 0001",
      },
    })

    stockedMedicine = await superuserPrisma.medicine.create({
      data: {
        clinicId: clinic.id,
        name: "Test Paracetamol",
        form: MedicineForm.TABLET,
        strength: "500mg",
        unit: MedicineUnit.PIECE,
        currentStock: 24,
        reorderLevel: 10,
        unitCost: 100,
        sellingPrice: 300,
      },
    })
    lowStockMedicine = await superuserPrisma.medicine.create({
      data: {
        clinicId: clinic.id,
        name: "Test Amoxicillin",
        form: MedicineForm.CAPSULE,
        strength: "500mg",
        unit: MedicineUnit.PIECE,
        currentStock: 3,
        reorderLevel: 10,
        unitCost: 200,
        sellingPrice: 500,
      },
    })
  })

  afterEach(async () => {
    await superuserPrisma.auditLog.deleteMany({ where: { clinicId: clinic.id } })
    await superuserPrisma.medicineDispensed.deleteMany({ where: { clinicId: clinic.id } })
    await superuserPrisma.payment.deleteMany({ where: { clinicId: clinic.id } })
    await superuserPrisma.consultation.deleteMany({ where: { clinicId: clinic.id } })
    await superuserPrisma.stockMovement.deleteMany({ where: { clinicId: clinic.id } })
    await superuserPrisma.queueEntry.deleteMany({ where: { clinicId: clinic.id } })
    await superuserPrisma.medicine.update({ where: { id: stockedMedicine.id }, data: { currentStock: 24 } })
    await superuserPrisma.medicine.update({ where: { id: lowStockMedicine.id }, data: { currentStock: 3 } })
  })

  afterAll(async () => {
    await superuserPrisma.medicine.deleteMany({ where: { clinicId: clinic.id } })
    await superuserPrisma.patient.deleteMany({ where: { clinicId: clinic.id } })
    await superuserPrisma.doctor.deleteMany({ where: { clinicId: clinic.id } })
    await superuserPrisma.user.deleteMany({ where: { clinicId: clinic.id } })
    await superuserPrisma.clinic.delete({ where: { id: clinic.id } })
    await superuserPrisma.holdingCompany.deleteMany({ where: { name: "Consult Test Holding" } })
    await superuserPrisma.$disconnect()
    await prisma.$disconnect()
  })

  it("saves a consultation, dispenses medicine deducting stock, records payment, and completes the queue entry", async () => {
    const entry = await createQueueEntry()

    const result = await saveConsultation(doctorUser, entry.id, {
      chiefComplaint: "Fever",
      diagnosis: "Viral infection",
      medicines: [
        { medicineId: stockedMedicine.id, medicineName: stockedMedicine.name, quantity: 5, dispensedFromStock: true },
      ],
      payment: { amount: 80000, method: "CASH" },
    })

    const medicine = await superuserPrisma.medicine.findUniqueOrThrow({ where: { id: stockedMedicine.id } })
    expect(medicine.currentStock).toBe(19) // 24 - 5

    const movement = await superuserPrisma.stockMovement.findFirst({ where: { medicineId: stockedMedicine.id } })
    expect(movement?.quantityChange).toBe(-5)
    expect(movement?.balanceAfter).toBe(19)

    const updatedEntry = await superuserPrisma.queueEntry.findUniqueOrThrow({ where: { id: entry.id } })
    expect(updatedEntry.status).toBe("COMPLETED")
    expect(updatedEntry.completedAt).toBeTruthy()

    const payment = await superuserPrisma.payment.findFirst({ where: { consultationId: result.consultationId } })
    expect(payment?.amount).toBe(80000)
    expect(payment?.collectedByUserId).toBe(doctorUser.id)

    // appears in the patient's history immediately
    const history = await listPatientConsultationHistory(doctorUser, patient.id)
    expect(history[0]?.diagnosis).toBe("Viral infection")
    expect(history[0]?.medicines[0]?.medicineName).toBe(stockedMedicine.name)

    // and in today's revenue, attributed to the collecting doctor
    const collections = await listMyCollectionsToday(doctorUser)
    expect(collections.total).toBe(80000)
    expect(collections.entries[0]?.amount).toBe(80000)
  })

  it("blocks the entire save when a dispensed quantity exceeds current stock, leaving stock and everything else untouched", async () => {
    const entry = await createQueueEntry()

    await expect(
      saveConsultation(doctorUser, entry.id, {
        chiefComplaint: "Infection",
        medicines: [
          { medicineId: lowStockMedicine.id, medicineName: "Test Amoxicillin", quantity: 10, dispensedFromStock: true },
        ],
        payment: { amount: 50000, method: "CASH" },
      })
    ).rejects.toBeInstanceOf(InsufficientStockError)

    const medicine = await superuserPrisma.medicine.findUniqueOrThrow({ where: { id: lowStockMedicine.id } })
    expect(medicine.currentStock).toBe(3) // untouched

    const consultationCount = await superuserPrisma.consultation.count({ where: { queueEntryId: entry.id } })
    expect(consultationCount).toBe(0) // nothing half-saved

    const entryAfter = await superuserPrisma.queueEntry.findUniqueOrThrow({ where: { id: entry.id } })
    expect(entryAfter.status).toBe("CALLED") // not completed
  })

  it("a prescribed-only row (matched catalog item, toggle off) doesn't touch stock", async () => {
    const entry = await createQueueEntry()

    await saveConsultation(doctorUser, entry.id, {
      chiefComplaint: "Follow-up",
      medicines: [
        { medicineId: stockedMedicine.id, medicineName: stockedMedicine.name, quantity: 5, dispensedFromStock: false },
      ],
      payment: { amount: 50000, method: "CASH" },
    })

    const medicine = await superuserPrisma.medicine.findUniqueOrThrow({ where: { id: stockedMedicine.id } })
    expect(medicine.currentStock).toBe(24) // unchanged

    const dispensed = await superuserPrisma.medicineDispensed.findFirst({ where: { clinicId: clinic.id }, orderBy: { createdAt: "desc" } })
    expect(dispensed?.medicineId).toBeNull()
    expect(dispensed?.stockMovementId).toBeNull()
  })

  it("a free-text medicine not in the catalog saves with no stock effect", async () => {
    const entry = await createQueueEntry()

    await saveConsultation(doctorUser, entry.id, {
      chiefComplaint: "Allergy",
      medicines: [
        { medicineId: null, medicineName: "Some Other Brand Antihistamine", quantity: 1, dispensedFromStock: false },
      ],
      payment: { amount: 50000, method: "CASH" },
    })

    const dispensed = await superuserPrisma.medicineDispensed.findFirst({ where: { medicineName: "Some Other Brand Antihistamine" } })
    expect(dispensed?.medicineId).toBeNull()
    expect(dispensed?.stockMovementId).toBeNull()
  })

  it("rejects saving a consultation for a queue entry not assigned to this doctor", async () => {
    const otherDocUser = await superuserPrisma.user.create({
      data: { clinicId: clinic.id, name: "Dr. Other", email: `dr-other-${Date.now()}@test.local`, passwordHash: "x", role: Role.DOCTOR },
    })
    const otherDoctor = await superuserPrisma.doctor.create({
      data: { userId: otherDocUser.id, clinicId: clinic.id, licenseNumber: "C2", consultationFee: 50000 },
    })
    const otherDoctorSubject: AbilitySubject = { id: otherDocUser.id, role: Role.DOCTOR, clinicId: clinic.id, holdingCompanyId: null }

    const entry = await createQueueEntry() // assigned to `doctorId`, not otherDoctor

    await expect(
      saveConsultation(otherDoctorSubject, entry.id, {
        chiefComplaint: "x",
        medicines: [],
        payment: { amount: 0, method: "CASH" },
      })
    ).rejects.toBeInstanceOf(ForbiddenError)

    await superuserPrisma.doctor.delete({ where: { id: otherDoctor.id } })
    await superuserPrisma.user.delete({ where: { id: otherDocUser.id } })
  })

  it("current_stock equals the sum of the movement ledger after a mixed sequence of dispenses", async () => {
    const entryA = await createQueueEntry()
    await saveConsultation(doctorUser, entryA.id, {
      chiefComplaint: "a",
      medicines: [{ medicineId: stockedMedicine.id, medicineName: stockedMedicine.name, quantity: 3, dispensedFromStock: true }],
      payment: { amount: 0, method: "CASH" },
    })
    const entryB = await createQueueEntry()
    await saveConsultation(doctorUser, entryB.id, {
      chiefComplaint: "b",
      medicines: [{ medicineId: stockedMedicine.id, medicineName: stockedMedicine.name, quantity: 2, dispensedFromStock: true }],
      payment: { amount: 0, method: "CASH" },
    })

    const medicine = await superuserPrisma.medicine.findUniqueOrThrow({ where: { id: stockedMedicine.id } })
    const movements = await superuserPrisma.stockMovement.findMany({ where: { medicineId: stockedMedicine.id } })
    const sum = movements.reduce((s, m) => s + m.quantityChange, 0)
    expect(medicine.currentStock).toBe(24 + sum)
    expect(medicine.currentStock).toBe(19) // 24 - 3 - 2
  })
})
