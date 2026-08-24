import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { Role, Sex, MedicineForm, MedicineUnit } from "@prisma/client"
import { superuserPrisma } from "@/lib/test/superuser-prisma"
import { prisma } from "@/lib/db/prisma"
import {
  listMedicines,
  getMedicineWithLedger,
  createMedicine,
  updateMedicine,
  receiveStock,
  submitPhysicalCount,
  deleteDispensedMedicine,
  getInventoryDashboardPanels,
} from "@/lib/queries/inventory"
import { saveConsultation, InsufficientStockError } from "@/lib/queries/consultations"
import { ForbiddenError } from "@/lib/permissions/errors"
import { todayAsQueueDate } from "@/lib/queries/queue"
import type { AbilitySubject } from "@/lib/permissions/ability"

/**
 * M4b's accept bar (§12): dispensing 5 from a stock of 24 leaves 19 with a
 * matching dispense movement (already covered by M4's consultations
 * tests); deleting that dispensed row returns stock to 24 via a return
 * movement, not an edit; a failed consultation save leaves stock
 * untouched (also M4); and current_stock equals the sum of the movement
 * ledger for every medicine after a mixed sequence of operations.
 */
describe("inventory", () => {
  let branch: { id: string; timezone: string }
  let clinicAdmin: AbilitySubject
  let frontDesk: AbilitySubject
  let doctorUser: AbilitySubject
  let doctorId: string
  let patient: { id: string }

  async function createMedicineDirect(overrides: {
    name: string
    currentStock: number
    reorderLevel?: number
    expiryDate?: Date | null
  }) {
    return superuserPrisma.medicine.create({
      data: {
        branchId: branch.id,
        name: overrides.name,
        form: MedicineForm.TABLET,
        strength: "500mg",
        unit: MedicineUnit.PIECE,
        currentStock: overrides.currentStock,
        reorderLevel: overrides.reorderLevel ?? 10,
        unitCost: 100,
        sellingPrice: 300,
        expiryDate: overrides.expiryDate ?? null,
      },
    })
  }

  async function createQueueEntry() {
    return superuserPrisma.queueEntry.create({
      data: {
        branchId: branch.id,
        patientId: patient.id,
        doctorId,
        queueNumber: Math.floor(Math.random() * 1_000_000) + 1,
        queueDate: todayAsQueueDate(branch.timezone),
        status: "CALLED",
        source: "WALK_IN",
        checkedInAt: new Date(),
        calledAt: new Date(),
        accessToken: `test-inv-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
    })
  }

  beforeAll(async () => {
    const holding = await superuserPrisma.holdingCompany.create({ data: { name: "Inventory Test Holding" } })
    const clinicRow = await superuserPrisma.clinic.create({
      data: { holdingCompanyId: holding.id, name: "Inventory Test Clinic" },
    })
    const branchRow = await superuserPrisma.branch.create({
      data: {
        clinicId: clinicRow.id,
        name: "Inventory Test Branch",
        slug: `inventory-test-${Date.now()}`,
        address: "1 Test St",
        city: "Test City",
        phone: "0000",
        timezone: "Asia/Manila",
        operatingHours: {},
      },
    })
    branch = { id: branchRow.id, timezone: branchRow.timezone }

    const adminUser = await superuserPrisma.user.create({
      data: { branchId: branch.id, name: "Admin", email: `admin-inv-${Date.now()}@test.local`, passwordHash: "x", role: Role.CLINIC_ADMIN },
    })
    clinicAdmin = { id: adminUser.id, role: Role.CLINIC_ADMIN, branchId: branch.id, holdingCompanyId: null }

    const fdUser = await superuserPrisma.user.create({
      data: { branchId: branch.id, name: "Front Desk", email: `fd-inv-${Date.now()}@test.local`, passwordHash: "x", role: Role.FRONT_DESK },
    })
    frontDesk = { id: fdUser.id, role: Role.FRONT_DESK, branchId: branch.id, holdingCompanyId: null }

    const docUser = await superuserPrisma.user.create({
      data: { branchId: branch.id, name: "Dr. Inventory", email: `dr-inv-${Date.now()}@test.local`, passwordHash: "x", role: Role.DOCTOR },
    })
    const doctor = await superuserPrisma.doctor.create({
      data: { userId: docUser.id, branchId: branch.id, licenseNumber: "I1", consultationFee: 50000 },
    })
    doctorId = doctor.id
    doctorUser = { id: docUser.id, role: Role.DOCTOR, branchId: branch.id, holdingCompanyId: null }

    patient = await superuserPrisma.patient.create({
      data: {
        branchId: branch.id,
        firstName: "Inventory",
        lastName: "Patient",
        birthdate: new Date("1990-01-01"),
        sex: Sex.FEMALE,
        phone: "+63 917 888 0000",
        address: "addr",
        emergencyContactName: "ec",
        emergencyContactPhone: "+63 917 888 0001",
      },
    })
  })

  afterEach(async () => {
    await superuserPrisma.auditLog.deleteMany({ where: { branchId: branch.id } })
    await superuserPrisma.medicineDispensed.deleteMany({ where: { branchId: branch.id } })
    await superuserPrisma.payment.deleteMany({ where: { branchId: branch.id } })
    await superuserPrisma.consultation.deleteMany({ where: { branchId: branch.id } })
    await superuserPrisma.stockMovement.deleteMany({ where: { branchId: branch.id } })
    await superuserPrisma.queueEntry.deleteMany({ where: { branchId: branch.id } })
    await superuserPrisma.medicine.deleteMany({ where: { branchId: branch.id } })
  })

  afterAll(async () => {
    await superuserPrisma.patient.deleteMany({ where: { branchId: branch.id } })
    await superuserPrisma.doctor.deleteMany({ where: { branchId: branch.id } })
    await superuserPrisma.user.deleteMany({ where: { branchId: branch.id } })
    const { clinicId } = await superuserPrisma.branch.findUniqueOrThrow({ where: { id: branch.id }, select: { clinicId: true } })
    await superuserPrisma.branch.delete({ where: { id: branch.id } })
    await superuserPrisma.clinic.delete({ where: { id: clinicId } })
    await superuserPrisma.holdingCompany.deleteMany({ where: { name: "Inventory Test Holding" } })
    await superuserPrisma.$disconnect()
    await prisma.$disconnect()
  })

  it("deleting a dispensed row returns stock via a return movement, not an edit to the original", async () => {
    const medicine = await createMedicineDirect({ name: "Amoxicillin", currentStock: 24 })
    const entry = await createQueueEntry()

    const { consultationId } = await saveConsultation(doctorUser, entry.id, {
      chiefComplaint: "x",
      medicines: [{ medicineId: medicine.id, medicineName: medicine.name, quantity: 5, dispensedFromStock: true }],
      payment: { amount: 0, method: "CASH" },
    })

    const afterDispense = await superuserPrisma.medicine.findUniqueOrThrow({ where: { id: medicine.id } })
    expect(afterDispense.currentStock).toBe(19)

    const dispensedRow = await superuserPrisma.medicineDispensed.findFirstOrThrow({ where: { consultationId } })
    const originalStockMovementId = dispensedRow.stockMovementId

    await deleteDispensedMedicine(clinicAdmin, dispensedRow.id, "Doctor recorded the wrong medicine")

    const afterDelete = await superuserPrisma.medicine.findUniqueOrThrow({ where: { id: medicine.id } })
    expect(afterDelete.currentStock).toBe(24) // back to original

    const returnMovement = await superuserPrisma.stockMovement.findFirst({ where: { movementType: "RETURN", medicineId: medicine.id } })
    expect(returnMovement).toBeTruthy()
    expect(returnMovement?.quantityChange).toBe(5)
    expect(returnMovement?.reason).toBe("Doctor recorded the wrong medicine")

    // the original dispense movement itself is untouched, not edited
    const originalMovement = await superuserPrisma.stockMovement.findUniqueOrThrow({ where: { id: originalStockMovementId! } })
    expect(originalMovement.movementType).toBe("DISPENSE")
    expect(originalMovement.quantityChange).toBe(-5)

    // the dispensed row is soft-deleted, not hard-deleted
    const softDeleted = await superuserPrisma.medicineDispensed.findUniqueOrThrow({ where: { id: dispensedRow.id } })
    expect(softDeleted.deletedAt).toBeTruthy()
  })

  it("only a clinic admin can delete a dispensed row", async () => {
    const medicine = await createMedicineDirect({ name: "Cetirizine", currentStock: 10 })
    const entry = await createQueueEntry()
    const { consultationId } = await saveConsultation(doctorUser, entry.id, {
      chiefComplaint: "x",
      medicines: [{ medicineId: medicine.id, medicineName: medicine.name, quantity: 1, dispensedFromStock: true }],
      payment: { amount: 0, method: "CASH" },
    })
    const dispensedRow = await superuserPrisma.medicineDispensed.findFirstOrThrow({ where: { consultationId } })

    await expect(deleteDispensedMedicine(frontDesk, dispensedRow.id, "test")).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("current_stock equals the sum of the movement ledger after a mixed receipt/dispense/adjustment/return sequence", async () => {
    const medicine = await createMedicineDirect({ name: "Mixed Sequence Med", currentStock: 0 })

    await receiveStock(clinicAdmin, { medicineId: medicine.id, quantity: 100, unitCost: 100 })
    const entryA = await createQueueEntry()
    await saveConsultation(doctorUser, entryA.id, {
      chiefComplaint: "a",
      medicines: [{ medicineId: medicine.id, medicineName: medicine.name, quantity: 30, dispensedFromStock: true }],
      payment: { amount: 0, method: "CASH" },
    })
    const dispensedA = await superuserPrisma.medicineDispensed.findFirstOrThrow({ where: { consultationId: (await superuserPrisma.consultation.findFirstOrThrow({ where: { queueEntryId: entryA.id } })).id } })
    await deleteDispensedMedicine(clinicAdmin, dispensedA.id, "correction")
    await submitPhysicalCount(clinicAdmin, { reason: "monthly count", counts: [{ medicineId: medicine.id, countedQuantity: 95 }] })

    const medicineAfter = await superuserPrisma.medicine.findUniqueOrThrow({ where: { id: medicine.id } })
    const movements = await superuserPrisma.stockMovement.findMany({ where: { medicineId: medicine.id } })
    const sum = movements.reduce((s, m) => s + m.quantityChange, 0)
    expect(medicineAfter.currentStock).toBe(sum)
    expect(medicineAfter.currentStock).toBe(95)
  })

  it("insufficient stock blocks the save by default, and the override dispenses the full amount with an audit entry naming the user", async () => {
    const medicine = await createMedicineDirect({ name: "Scarce Med", currentStock: 3 })
    const entry1 = await createQueueEntry()

    await expect(
      saveConsultation(doctorUser, entry1.id, {
        chiefComplaint: "x",
        medicines: [{ medicineId: medicine.id, medicineName: medicine.name, quantity: 10, dispensedFromStock: true }],
        payment: { amount: 0, method: "CASH" },
      })
    ).rejects.toBeInstanceOf(InsufficientStockError)

    const entry2 = await createQueueEntry()
    await saveConsultation(doctorUser, entry2.id, {
      chiefComplaint: "x",
      medicines: [{ medicineId: medicine.id, medicineName: medicine.name, quantity: 10, dispensedFromStock: true }],
      overrideInsufficientStock: true,
      payment: { amount: 0, method: "CASH" },
    })

    const medicineAfter = await superuserPrisma.medicine.findUniqueOrThrow({ where: { id: medicine.id } })
    expect(medicineAfter.currentStock).toBe(-7) // 3 - 10, driven to the true (negative) figure

    const log = await superuserPrisma.auditLog.findFirst({ where: { branchId: branch.id, action: "medicine.dispense_override", userId: doctorUser.id } })
    expect(log).toBeTruthy()
  })

  it("receiving stock writes a receipt movement and can update the expiry date when asked to", async () => {
    const oldExpiry = new Date("2026-09-01")
    const medicine = await createMedicineDirect({ name: "Expiry Med", currentStock: 10, expiryDate: oldExpiry })

    const newExpiry = new Date("2027-01-01")
    const updated = await receiveStock(clinicAdmin, {
      medicineId: medicine.id,
      quantity: 50,
      unitCost: 120,
      expiryDate: newExpiry.toISOString(),
      updateExpiryDate: true,
    })

    expect(updated.currentStock).toBe(60)
    expect(updated.expiryDate?.getTime()).toBe(newExpiry.getTime())

    const receipt = await superuserPrisma.stockMovement.findFirst({ where: { medicineId: medicine.id, movementType: "RECEIPT" } })
    expect(receipt?.quantityChange).toBe(50)
    expect(receipt?.balanceAfter).toBe(60)
  })

  it("a physical count writes one adjustment movement per discrepancy and computes the peso variance", async () => {
    const overCounted = await createMedicineDirect({ name: "Over Counted", currentStock: 20 })
    const underCounted = await createMedicineDirect({ name: "Under Counted", currentStock: 20 })
    const unchanged = await createMedicineDirect({ name: "Unchanged", currentStock: 20 })

    const result = await submitPhysicalCount(clinicAdmin, {
      reason: "Q3 physical count",
      counts: [
        { medicineId: overCounted.id, countedQuantity: 25 }, // +5
        { medicineId: underCounted.id, countedQuantity: 15 }, // -5
        { medicineId: unchanged.id, countedQuantity: 20 }, // no change — no movement
      ],
    })

    expect(result.discrepancies).toBe(2)
    expect(result.totalVarianceCentavos).toBe(5 * 100 + -5 * 100) // unitCost 100 each

    const unchangedMovements = await superuserPrisma.stockMovement.count({ where: { medicineId: unchanged.id } })
    expect(unchangedMovements).toBe(0)

    const overMovement = await superuserPrisma.stockMovement.findFirstOrThrow({ where: { medicineId: overCounted.id } })
    expect(overMovement.reason).toBe("Q3 physical count")
    expect(overMovement.quantityChange).toBe(5)
  })

  it("only a clinic admin can create or edit a catalog medicine", async () => {
    await expect(
      createMedicine(frontDesk, {
        name: "x",
        form: "TABLET",
        unit: "PIECE",
        reorderLevel: 10,
        unitCost: 100,
        sellingPrice: 200,
        isActive: true,
      })
    ).rejects.toBeInstanceOf(ForbiddenError)

    const created = await createMedicine(clinicAdmin, {
      name: "New Catalog Med",
      form: "TABLET",
      unit: "PIECE",
      reorderLevel: 10,
      unitCost: 100,
      sellingPrice: 200,
      isActive: true,
    })
    expect(created.currentStock).toBe(0) // new medicines start with no stock — only receiveStock changes it

    await expect(
      updateMedicine(frontDesk, created.id, {
        name: "New Catalog Med",
        form: "TABLET",
        unit: "PIECE",
        reorderLevel: 20,
        unitCost: 100,
        sellingPrice: 200,
        isActive: true,
      })
    ).rejects.toBeInstanceOf(ForbiddenError)

    const updated = await updateMedicine(clinicAdmin, created.id, {
      name: "New Catalog Med",
      form: "TABLET",
      unit: "PIECE",
      reorderLevel: 20,
      unitCost: 100,
      sellingPrice: 200,
      isActive: false, // deactivate
    })
    expect(updated.reorderLevel).toBe(20)
    expect(updated.isActive).toBe(false)
  })

  it("lists low-stock, expiring, and expired medicines correctly", async () => {
    const low = await createMedicineDirect({ name: "Low Stock Med", currentStock: 2, reorderLevel: 10 })
    const fine = await createMedicineDirect({ name: "Fine Stock Med", currentStock: 50, reorderLevel: 10 })
    const expiringSoon = await createMedicineDirect({
      name: "Expiring Med",
      currentStock: 10,
      expiryDate: new Date(Date.now() + 10 * 86_400_000),
    })
    const expired = await createMedicineDirect({
      name: "Expired Med",
      currentStock: 10,
      expiryDate: new Date(Date.now() - 10 * 86_400_000),
    })

    const lowStockList = await listMedicines(clinicAdmin, { filter: "low-stock" })
    expect(lowStockList.map((m) => m.id)).toContain(low.id)
    expect(lowStockList.map((m) => m.id)).not.toContain(fine.id)

    const expiringList = await listMedicines(clinicAdmin, { filter: "expiring" })
    expect(expiringList.map((m) => m.id)).toContain(expiringSoon.id)
    expect(expiringList.map((m) => m.id)).not.toContain(expired.id)

    const expiredList = await listMedicines(clinicAdmin, { filter: "expired" })
    expect(expiredList.map((m) => m.id)).toContain(expired.id)

    const panels = await getInventoryDashboardPanels(clinicAdmin)
    expect(panels.lowStock.map((m) => m.id)).toContain(low.id)
    expect(panels.expiringSoon.map((m) => m.id)).toContain(expiringSoon.id)
    expect(panels.expired.map((m) => m.id)).toContain(expired.id)
  })

  it("scopes the medicine ledger to the caller's own branch", async () => {
    const otherClinic = await superuserPrisma.clinic.create({ data: { name: "Other" } })
    const otherBranch = await superuserPrisma.branch.create({
      data: { clinicId: otherClinic.id, name: "Other", slug: `other-inv-${Date.now()}`, address: "x", city: "x", phone: "0", timezone: "Asia/Manila", operatingHours: {} },
    })
    const otherMedicine = await superuserPrisma.medicine.create({
      data: { branchId: otherBranch.id, name: "Other Branch Med", form: MedicineForm.TABLET, unit: MedicineUnit.PIECE, currentStock: 10, reorderLevel: 5, unitCost: 100, sellingPrice: 200 },
    })

    const result = await getMedicineWithLedger(clinicAdmin, otherMedicine.id)
    expect(result).toBeNull()

    await superuserPrisma.medicine.delete({ where: { id: otherMedicine.id } })
    await superuserPrisma.branch.delete({ where: { id: otherBranch.id } })
    await superuserPrisma.clinic.delete({ where: { id: otherClinic.id } })
  })
})
