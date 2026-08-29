import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { Role, Sex, MedicineForm, MedicineUnit, StockMovementType } from "@prisma/client"
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
import { listDispensableMedicines } from "@/lib/queries/medicines"
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

  // ── Branch-isolation fixture ────────────────────────────────────────
  // Moving inventory from clinic_id to branch_id introduced a boundary no
  // cross-*clinic* fixture can exercise: two branches under ONE clinic.
  // `siblingBranch` is a second branch of this file's own clinic — the
  // caller (`clinicAdmin`) shares a parent clinic with it and must still
  // see nothing. `branchB` lives under a second clinic of the same holding
  // company and is the older cross-clinic control, kept alongside so both
  // boundaries are proved by the same tests.
  let siblingBranch: { id: string }
  let siblingAdmin: AbilitySubject
  let branchB: { id: string }
  let branchBAdmin: AbilitySubject
  let clinicBId: string
  let siblingMeds: {
    ledger: { id: string }
    receive: { id: string }
    update: { id: string }
    count: { id: string }
    dispense: { id: string }
    low: { id: string }
    expiring: { id: string }
    expired: { id: string }
  }
  let branchBMeds: {
    plain: { id: string }
    low: { id: string }
    expiring: { id: string }
    expired: { id: string }
  }
  let siblingLedgerMovementId: string
  let siblingDispensedId: string
  /** Stock the sibling's dispense fixture starts at — a leaked RETURN would push it to 40. */
  const SIBLING_DISPENSE_STOCK = 37

  /** Every medicine that is NOT this caller's, across both foreign branches. */
  function foreignMedicineIds(): string[] {
    return [...Object.values(siblingMeds), ...Object.values(branchBMeds)].map((m) => m.id)
  }

  /** Same shape as `createMedicineDirect`, but for an arbitrary (foreign) branch. */
  async function createMedicineIn(
    branchId: string,
    overrides: { name: string; currentStock: number; reorderLevel?: number; expiryDate?: Date | null }
  ) {
    return superuserPrisma.medicine.create({
      data: {
        branchId,
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

    // ── Branch-isolation fixture ──────────────────────────────────────
    // `inv-` prefixes below keep every slug/email/token unique to this
    // file: sibling test files run against the same local database and
    // share the branches.slug and users.email unique indexes.
    const stamp = Date.now()

    const siblingBranchRow = await superuserPrisma.branch.create({
      data: {
        clinicId: clinicRow.id, // deliberately THE SAME clinic as `branch`
        name: "Inventory Test Branch — sibling",
        slug: `inv-sibling-${stamp}`,
        address: "2 Test St",
        city: "Test City",
        phone: "0000",
        timezone: "Asia/Manila",
        operatingHours: {},
      },
    })
    siblingBranch = { id: siblingBranchRow.id }

    const clinicB = await superuserPrisma.clinic.create({
      data: { holdingCompanyId: holding.id, name: "Inventory Test Clinic B" },
    })
    clinicBId = clinicB.id
    const branchBRow = await superuserPrisma.branch.create({
      data: {
        clinicId: clinicB.id,
        name: "Inventory Test Branch B",
        slug: `inv-branch-b-${stamp}`,
        address: "3 Test St",
        city: "Test City",
        phone: "0000",
        timezone: "Asia/Manila",
        operatingHours: {},
      },
    })
    branchB = { id: branchBRow.id }

    const sibAdminUser = await superuserPrisma.user.create({
      data: {
        branchId: siblingBranch.id,
        name: "Sibling Admin",
        email: `inv-sib-admin-${stamp}@test.local`,
        passwordHash: "x",
        role: Role.CLINIC_ADMIN,
      },
    })
    siblingAdmin = { id: sibAdminUser.id, role: Role.CLINIC_ADMIN, branchId: siblingBranch.id, holdingCompanyId: null }

    const bbAdminUser = await superuserPrisma.user.create({
      data: {
        branchId: branchB.id,
        name: "Branch B Admin",
        email: `inv-bb-admin-${stamp}@test.local`,
        passwordHash: "x",
        role: Role.CLINIC_ADMIN,
      },
    })
    branchBAdmin = { id: bbAdminUser.id, role: Role.CLINIC_ADMIN, branchId: branchB.id, holdingCompanyId: null }

    siblingMeds = {
      ledger: await createMedicineIn(siblingBranch.id, { name: "Sibling Ledger Med", currentStock: 40, reorderLevel: 5 }),
      receive: await createMedicineIn(siblingBranch.id, { name: "Sibling Receive Med", currentStock: 40, reorderLevel: 5 }),
      update: await createMedicineIn(siblingBranch.id, { name: "Sibling Update Med", currentStock: 40, reorderLevel: 7 }),
      count: await createMedicineIn(siblingBranch.id, { name: "Sibling Count Med", currentStock: 40, reorderLevel: 5 }),
      dispense: await createMedicineIn(siblingBranch.id, {
        name: "Sibling Dispense Med",
        currentStock: SIBLING_DISPENSE_STOCK,
        reorderLevel: 5,
      }),
      low: await createMedicineIn(siblingBranch.id, { name: "Sibling Low Stock Med", currentStock: 1, reorderLevel: 10 }),
      expiring: await createMedicineIn(siblingBranch.id, {
        name: "Sibling Expiring Med",
        currentStock: 50,
        reorderLevel: 5,
        expiryDate: new Date(Date.now() + 10 * 86_400_000),
      }),
      expired: await createMedicineIn(siblingBranch.id, {
        name: "Sibling Expired Med",
        currentStock: 50,
        reorderLevel: 5,
        expiryDate: new Date(Date.now() - 10 * 86_400_000),
      }),
    }

    branchBMeds = {
      plain: await createMedicineIn(branchB.id, { name: "Branch B Plain Med", currentStock: 40, reorderLevel: 5 }),
      low: await createMedicineIn(branchB.id, { name: "Branch B Low Stock Med", currentStock: 1, reorderLevel: 10 }),
      expiring: await createMedicineIn(branchB.id, {
        name: "Branch B Expiring Med",
        currentStock: 50,
        reorderLevel: 5,
        expiryDate: new Date(Date.now() + 10 * 86_400_000),
      }),
      expired: await createMedicineIn(branchB.id, {
        name: "Branch B Expired Med",
        currentStock: 50,
        reorderLevel: 5,
        expiryDate: new Date(Date.now() - 10 * 86_400_000),
      }),
    }

    // A real movement on the sibling's ledger medicine, so a leak in
    // getMedicineWithLedger would surface a non-empty ledger rather than
    // an empty one that looks the same as "correctly hidden".
    const sibLedgerMovement = await superuserPrisma.stockMovement.create({
      data: {
        branchId: siblingBranch.id,
        medicineId: siblingMeds.ledger.id,
        movementType: StockMovementType.RECEIPT,
        quantityChange: 40,
        balanceAfter: 40,
        reason: "sibling opening stock",
        performedByUserId: sibAdminUser.id,
      },
    })
    siblingLedgerMovementId = sibLedgerMovement.id

    // A dispensed row in the sibling branch, complete with its originating
    // DISPENSE movement — so deleteDispensedMedicine's compensating-RETURN
    // path is the one that would run if the branch guard failed.
    const sibDocUser = await superuserPrisma.user.create({
      data: {
        branchId: siblingBranch.id,
        name: "Dr. Sibling",
        email: `inv-sib-dr-${stamp}@test.local`,
        passwordHash: "x",
        role: Role.DOCTOR,
      },
    })
    const sibDoctor = await superuserPrisma.doctor.create({
      data: { userId: sibDocUser.id, branchId: siblingBranch.id, licenseNumber: "S1", consultationFee: 50000 },
    })
    const sibPatient = await superuserPrisma.patient.create({
      data: {
        branchId: siblingBranch.id,
        firstName: "Sibling",
        lastName: "Patient",
        birthdate: new Date("1990-01-01"),
        sex: Sex.FEMALE,
        phone: "+63 917 888 0002",
        address: "addr",
        emergencyContactName: "ec",
        emergencyContactPhone: "+63 917 888 0003",
      },
    })
    const sibEntry = await superuserPrisma.queueEntry.create({
      data: {
        branchId: siblingBranch.id,
        patientId: sibPatient.id,
        doctorId: sibDoctor.id,
        queueNumber: 1,
        queueDate: todayAsQueueDate("Asia/Manila"),
        status: "CALLED",
        source: "WALK_IN",
        checkedInAt: new Date(),
        calledAt: new Date(),
        accessToken: `test-inv-sib-${stamp}-${Math.random().toString(36).slice(2)}`,
      },
    })
    const sibConsultation = await superuserPrisma.consultation.create({
      data: {
        queueEntryId: sibEntry.id,
        patientId: sibPatient.id,
        doctorId: sibDoctor.id,
        branchId: siblingBranch.id,
        chiefComplaint: "sibling visit",
      },
    })
    const sibDispenseMovement = await superuserPrisma.stockMovement.create({
      data: {
        branchId: siblingBranch.id,
        medicineId: siblingMeds.dispense.id,
        movementType: StockMovementType.DISPENSE,
        quantityChange: -3,
        balanceAfter: SIBLING_DISPENSE_STOCK,
        reason: "sibling dispense",
        performedByUserId: sibDocUser.id,
      },
    })
    const sibDispensed = await superuserPrisma.medicineDispensed.create({
      data: {
        branchId: siblingBranch.id,
        consultationId: sibConsultation.id,
        medicineId: siblingMeds.dispense.id,
        medicineName: "Sibling Dispense Med",
        quantity: 3,
        unitPrice: 300,
        stockMovementId: sibDispenseMovement.id,
      },
    })
    siblingDispensedId = sibDispensed.id
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
    // The branch-isolation fixture goes first: the sibling branch hangs off
    // the same clinic the existing teardown below deletes, so its rows have
    // to be gone before that clinic row can go.
    const foreignBranchIds = [siblingBranch.id, branchB.id]
    await superuserPrisma.auditLog.deleteMany({ where: { branchId: { in: foreignBranchIds } } })
    await superuserPrisma.medicineDispensed.deleteMany({ where: { branchId: { in: foreignBranchIds } } })
    await superuserPrisma.payment.deleteMany({ where: { branchId: { in: foreignBranchIds } } })
    await superuserPrisma.consultation.deleteMany({ where: { branchId: { in: foreignBranchIds } } })
    await superuserPrisma.stockMovement.deleteMany({ where: { branchId: { in: foreignBranchIds } } })
    await superuserPrisma.queueEntry.deleteMany({ where: { branchId: { in: foreignBranchIds } } })
    await superuserPrisma.medicine.deleteMany({ where: { branchId: { in: foreignBranchIds } } })
    await superuserPrisma.patient.deleteMany({ where: { branchId: { in: foreignBranchIds } } })
    await superuserPrisma.doctor.deleteMany({ where: { branchId: { in: foreignBranchIds } } })
    await superuserPrisma.user.deleteMany({ where: { branchId: { in: foreignBranchIds } } })
    await superuserPrisma.branch.deleteMany({ where: { id: { in: foreignBranchIds } } })
    await superuserPrisma.clinic.delete({ where: { id: clinicBId } })

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

  // ─────────────────────────────────────────────────────────────────────
  // Branch isolation — the boundary the clinic_id → branch_id refactor
  // introduced. The test directly above proves the OLD cross-*clinic*
  // boundary; a regression that leaked between two branches of the SAME
  // clinic would sail straight past it. Everything below pairs each
  // "the foreign row is absent" assertion with a positive control, because
  // an absence assertion also passes against a query that returns nothing,
  // a wiped table, or a fixture that never got created.
  // ─────────────────────────────────────────────────────────────────────

  it("getMedicineWithLedger returns null for a sibling branch's medicine — sharing a clinic buys no access", async () => {
    // Positive control A: the caller's own medicine reads back fine, so a
    // null below is about the branch, not about the function being broken.
    const own = await createMedicineDirect({ name: "Own Ledger Med", currentStock: 12 })
    const ownResult = await getMedicineWithLedger(clinicAdmin, own.id)
    expect(ownResult?.medicine.id).toBe(own.id)

    // Positive control B: the sibling's medicine genuinely exists AND has a
    // non-empty ledger — so "null" below is a refusal, not an empty fixture.
    const fromItsOwnBranch = await getMedicineWithLedger(siblingAdmin, siblingMeds.ledger.id)
    expect(fromItsOwnBranch?.medicine.id).toBe(siblingMeds.ledger.id)
    expect(fromItsOwnBranch?.ledger).toHaveLength(1)

    // inventory.ts:52 is `if (!medicine) return null` — the refusal here is
    // a null, NOT a ForbiddenError, unlike updateMedicine/receiveStock in
    // the same file. Asserting what the code actually does today; the
    // throw-vs-null inconsistency is recorded as a separate decision.
    const sibling = await getMedicineWithLedger(clinicAdmin, siblingMeds.ledger.id)
    expect(sibling).toBeNull()

    // and the cross-clinic control still holds at the same call site
    const crossClinic = await getMedicineWithLedger(clinicAdmin, branchBMeds.plain.id)
    expect(crossClinic).toBeNull()
  })

  it("listMedicines and every dashboard panel exclude both a sibling branch's and another clinic's medicines", async () => {
    const ownLow = await createMedicineDirect({ name: "Own Low Stock Med", currentStock: 2, reorderLevel: 10 })
    const ownExpiring = await createMedicineDirect({
      name: "Own Expiring Med",
      currentStock: 50,
      reorderLevel: 5,
      expiryDate: new Date(Date.now() + 10 * 86_400_000),
    })
    const ownExpired = await createMedicineDirect({
      name: "Own Expired Med",
      currentStock: 50,
      reorderLevel: 5,
      expiryDate: new Date(Date.now() - 10 * 86_400_000),
    })

    const allIds = (await listMedicines(clinicAdmin)).map((m) => m.id)
    expect(allIds).toContain(ownLow.id) // positive control
    expect(allIds).toContain(ownExpiring.id)
    expect(allIds).toContain(ownExpired.id)
    for (const foreignId of foreignMedicineIds()) {
      expect(allIds).not.toContain(foreignId)
    }

    // Positive control for the whole foreign fixture: those same rows are
    // listable by the branches that own them, so their absence above is
    // scoping and not eight medicines that failed to be created.
    const siblingOwnIds = (await listMedicines(siblingAdmin)).map((m) => m.id)
    expect(siblingOwnIds).toEqual(expect.arrayContaining(Object.values(siblingMeds).map((m) => m.id)))
    expect(siblingOwnIds).not.toContain(ownLow.id)
    const branchBOwnIds = (await listMedicines(branchBAdmin)).map((m) => m.id)
    expect(branchBOwnIds).toEqual(expect.arrayContaining(Object.values(branchBMeds).map((m) => m.id)))
    expect(branchBOwnIds).not.toContain(ownLow.id)

    // The filtered variants run a different code path from the default
    // list (post-filtering on the DTO flags), so each is exercised against
    // a foreign row that WOULD match the filter.
    const lowIds = (await listMedicines(clinicAdmin, { filter: "low-stock" })).map((m) => m.id)
    expect(lowIds).toContain(ownLow.id)
    expect(lowIds).not.toContain(siblingMeds.low.id)
    expect(lowIds).not.toContain(branchBMeds.low.id)

    const expiringIds = (await listMedicines(clinicAdmin, { filter: "expiring" })).map((m) => m.id)
    expect(expiringIds).toContain(ownExpiring.id)
    expect(expiringIds).not.toContain(siblingMeds.expiring.id)
    expect(expiringIds).not.toContain(branchBMeds.expiring.id)

    const expiredIds = (await listMedicines(clinicAdmin, { filter: "expired" })).map((m) => m.id)
    expect(expiredIds).toContain(ownExpired.id)
    expect(expiredIds).not.toContain(siblingMeds.expired.id)
    expect(expiredIds).not.toContain(branchBMeds.expired.id)

    // search is a separate where-clause branch — the sibling's names must
    // stay invisible even when the search term matches them exactly
    const searchIds = (await listMedicines(clinicAdmin, { search: "Med" })).map((m) => m.id)
    expect(searchIds).toContain(ownLow.id)
    for (const foreignId of foreignMedicineIds()) {
      expect(searchIds).not.toContain(foreignId)
    }

    // includeInactive widens the where-clause; it must not widen the branch
    const inactiveIds = (await listMedicines(clinicAdmin, { includeInactive: true })).map((m) => m.id)
    expect(inactiveIds).toContain(ownLow.id)
    for (const foreignId of foreignMedicineIds()) {
      expect(inactiveIds).not.toContain(foreignId)
    }

    const panels = await getInventoryDashboardPanels(clinicAdmin)
    expect(panels.lowStock.map((m) => m.id)).toContain(ownLow.id)
    expect(panels.lowStock.map((m) => m.id)).not.toContain(siblingMeds.low.id)
    expect(panels.lowStock.map((m) => m.id)).not.toContain(branchBMeds.low.id)
    expect(panels.expiringSoon.map((m) => m.id)).toContain(ownExpiring.id)
    expect(panels.expiringSoon.map((m) => m.id)).not.toContain(siblingMeds.expiring.id)
    expect(panels.expiringSoon.map((m) => m.id)).not.toContain(branchBMeds.expiring.id)
    expect(panels.expired.map((m) => m.id)).toContain(ownExpired.id)
    expect(panels.expired.map((m) => m.id)).not.toContain(siblingMeds.expired.id)
    expect(panels.expired.map((m) => m.id)).not.toContain(branchBMeds.expired.id)
  })

  it("receiveStock into a sibling branch's medicine is refused and writes no movement row", async () => {
    const before = await superuserPrisma.medicine.findUniqueOrThrow({ where: { id: siblingMeds.receive.id } })

    // CLINIC_ADMIN passes receiveStock's role gate, so this rejection is
    // the branch check firing, not the role check.
    await expect(
      receiveStock(clinicAdmin, { medicineId: siblingMeds.receive.id, quantity: 25, unitCost: 999 })
    ).rejects.toBeInstanceOf(ForbiddenError)

    // The rejection is not the point — this is. A ForbiddenError thrown
    // after a stock movement had already been written would still pass the
    // line above.
    const after = await superuserPrisma.medicine.findUniqueOrThrow({ where: { id: siblingMeds.receive.id } })
    expect(after.currentStock).toBe(before.currentStock)
    expect(after.unitCost).toBe(before.unitCost)
    expect(await superuserPrisma.stockMovement.count({ where: { medicineId: siblingMeds.receive.id } })).toBe(0)

    // Positive control: the identical call against the caller's own
    // medicine does move stock and does write exactly one movement.
    const own = await createMedicineDirect({ name: "Own Receive Med", currentStock: 10 })
    const updated = await receiveStock(clinicAdmin, { medicineId: own.id, quantity: 25, unitCost: 999 })
    expect(updated.currentStock).toBe(35)
    expect(await superuserPrisma.stockMovement.count({ where: { medicineId: own.id } })).toBe(1)
  })

  it("updateMedicine on a sibling branch's medicine is refused and leaves its catalog fields untouched", async () => {
    const before = await superuserPrisma.medicine.findUniqueOrThrow({ where: { id: siblingMeds.update.id } })
    const payload = {
      name: "Hijacked Name",
      form: "CAPSULE",
      unit: "BOX",
      reorderLevel: 999,
      unitCost: 1,
      sellingPrice: 1,
      isActive: false,
    }

    // Distinct from the existing role test above: that one proves a
    // FRONT_DESK is blocked. This caller IS a clinic admin — the only
    // thing standing between it and the row is the branch.
    await expect(updateMedicine(clinicAdmin, siblingMeds.update.id, payload)).rejects.toBeInstanceOf(ForbiddenError)

    const after = await superuserPrisma.medicine.findUniqueOrThrow({ where: { id: siblingMeds.update.id } })
    expect(after.reorderLevel).toBe(before.reorderLevel)
    expect(after.isActive).toBe(before.isActive)
    expect(after.name).toBe(before.name)
    expect(after.sellingPrice).toBe(before.sellingPrice)

    // Positive control: same admin, same payload, own branch — it applies.
    const own = await createMedicineDirect({ name: "Own Update Med", currentStock: 10, reorderLevel: 7 })
    const updated = await updateMedicine(clinicAdmin, own.id, payload)
    expect(updated.reorderLevel).toBe(999)
    expect(updated.isActive).toBe(false)
  })

  it("a physical count batch mixing an own and a sibling medicine adjusts only the caller's own", async () => {
    const own = await createMedicineDirect({ name: "Own Counted Med", currentStock: 20 })
    const siblingBefore = await superuserPrisma.medicine.findUniqueOrThrow({ where: { id: siblingMeds.count.id } })

    const result = await submitPhysicalCount(clinicAdmin, {
      reason: "mixed-branch count",
      counts: [
        { medicineId: own.id, countedQuantity: 25 }, // +5, in branch
        { medicineId: siblingMeds.count.id, countedQuantity: 0 }, // would be -40, foreign branch
      ],
    })

    // Today's real behaviour: inventory.ts:208 is a bare `continue`, so the
    // foreign row is silently dropped from the batch rather than rejecting
    // the whole submission. Asserting what the code does, not what it
    // arguably should — the property under test is that no data crosses.
    expect(result.discrepancies).toBe(1)
    expect(result.totalVarianceCentavos).toBe(5 * 100)

    // Positive control: the own-branch half of the very same batch DID run,
    // so "the sibling was untouched" isn't just the whole call no-opping.
    const ownAfter = await superuserPrisma.medicine.findUniqueOrThrow({ where: { id: own.id } })
    expect(ownAfter.currentStock).toBe(25)
    expect(await superuserPrisma.stockMovement.count({ where: { medicineId: own.id } })).toBe(1)

    const siblingAfter = await superuserPrisma.medicine.findUniqueOrThrow({ where: { id: siblingMeds.count.id } })
    expect(siblingAfter.currentStock).toBe(siblingBefore.currentStock)
    expect(await superuserPrisma.stockMovement.count({ where: { medicineId: siblingMeds.count.id } })).toBe(0)
  })

  it("deleteDispensedMedicine on a sibling branch's dispensed row writes no compensating return", async () => {
    await expect(
      deleteDispensedMedicine(clinicAdmin, siblingDispensedId, "not mine to correct")
    ).rejects.toBeInstanceOf(ForbiddenError)

    const row = await superuserPrisma.medicineDispensed.findUniqueOrThrow({ where: { id: siblingDispensedId } })
    expect(row.deletedAt).toBeNull()

    const siblingMedicine = await superuserPrisma.medicine.findUniqueOrThrow({ where: { id: siblingMeds.dispense.id } })
    expect(siblingMedicine.currentStock).toBe(SIBLING_DISPENSE_STOCK) // a leaked RETURN would make this 40
    expect(
      await superuserPrisma.stockMovement.count({
        where: { medicineId: siblingMeds.dispense.id, movementType: StockMovementType.RETURN },
      })
    ).toBe(0)
    // still just the original DISPENSE the fixture created
    expect(await superuserPrisma.stockMovement.count({ where: { medicineId: siblingMeds.dispense.id } })).toBe(1)

    // Positive control: the same admin deleting an own-branch dispensed row
    // does soft-delete it and does write the RETURN.
    const ownMedicine = await createMedicineDirect({ name: "Own Dispense Med", currentStock: 20 })
    const entry = await createQueueEntry()
    const { consultationId } = await saveConsultation(doctorUser, entry.id, {
      chiefComplaint: "x",
      medicines: [{ medicineId: ownMedicine.id, medicineName: ownMedicine.name, quantity: 4, dispensedFromStock: true }],
      payment: { amount: 0, method: "CASH" },
    })
    const ownDispensed = await superuserPrisma.medicineDispensed.findFirstOrThrow({ where: { consultationId } })
    await deleteDispensedMedicine(clinicAdmin, ownDispensed.id, "genuine correction")

    expect((await superuserPrisma.medicineDispensed.findUniqueOrThrow({ where: { id: ownDispensed.id } })).deletedAt).toBeTruthy()
    expect(
      await superuserPrisma.stockMovement.count({
        where: { medicineId: ownMedicine.id, movementType: StockMovementType.RETURN },
      })
    ).toBe(1)
    expect((await superuserPrisma.medicine.findUniqueOrThrow({ where: { id: ownMedicine.id } })).currentStock).toBe(20)
  })

  it("RLS backstop: a sibling branch's medicines and stock movements are hidden at the database layer too", async () => {
    // `prisma` (APP_DATABASE_URL, non-superuser) — NOT superuserPrisma,
    // which bypasses RLS and would make the negative half meaningless.
    const hidden = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.role', ${Role.CLINIC_ADMIN}, true)`
      await tx.$executeRaw`SELECT set_config('app.user_id', ${clinicAdmin.id}, true)`
      await tx.$executeRaw`SELECT set_config('app.branch_id', ${branch.id}, true)`
      // deliberately unfiltered by branch — proves the policy hides these,
      // not the application's own where-clause
      return {
        medicines: await tx.medicine.findMany({ where: { id: siblingMeds.ledger.id } }),
        movements: await tx.stockMovement.findMany({ where: { id: siblingLedgerMovementId } }),
      }
    })
    expect(hidden.medicines).toHaveLength(0)
    expect(hidden.movements).toHaveLength(0)

    // Positive control: identical queries, identical code path, only
    // app.branch_id differs. Without this, a policy that hid every row
    // unconditionally — or a fixture that was never written — would satisfy
    // the assertions above just as well.
    const visible = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.role', ${Role.CLINIC_ADMIN}, true)`
      await tx.$executeRaw`SELECT set_config('app.user_id', ${siblingAdmin.id}, true)`
      await tx.$executeRaw`SELECT set_config('app.branch_id', ${siblingBranch.id}, true)`
      return {
        medicines: await tx.medicine.findMany({ where: { id: siblingMeds.ledger.id } }),
        movements: await tx.stockMovement.findMany({ where: { id: siblingLedgerMovementId } }),
      }
    })
    expect(visible.medicines).toHaveLength(1)
    expect(visible.movements).toHaveLength(1)
  })

  it("RLS backstop: another clinic's medicines and stock movements are hidden at the database layer too", async () => {
    const bbMovement = await superuserPrisma.stockMovement.create({
      data: {
        branchId: branchB.id,
        medicineId: branchBMeds.plain.id,
        movementType: StockMovementType.RECEIPT,
        quantityChange: 40,
        balanceAfter: 40,
        reason: "branch B opening stock",
        performedByUserId: branchBAdmin.id,
      },
    })

    const hidden = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.role', ${Role.CLINIC_ADMIN}, true)`
      await tx.$executeRaw`SELECT set_config('app.user_id', ${clinicAdmin.id}, true)`
      await tx.$executeRaw`SELECT set_config('app.branch_id', ${branch.id}, true)`
      return {
        medicines: await tx.medicine.findMany({ where: { id: branchBMeds.plain.id } }),
        movements: await tx.stockMovement.findMany({ where: { id: bbMovement.id } }),
      }
    })
    expect(hidden.medicines).toHaveLength(0)
    expect(hidden.movements).toHaveLength(0)

    const visible = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.role', ${Role.CLINIC_ADMIN}, true)`
      await tx.$executeRaw`SELECT set_config('app.user_id', ${branchBAdmin.id}, true)`
      await tx.$executeRaw`SELECT set_config('app.branch_id', ${branchB.id}, true)`
      return {
        medicines: await tx.medicine.findMany({ where: { id: branchBMeds.plain.id } }),
        movements: await tx.stockMovement.findMany({ where: { id: bbMovement.id } }),
      }
    })
    expect(visible.medicines).toHaveLength(1)
    expect(visible.movements).toHaveLength(1)

    await superuserPrisma.stockMovement.delete({ where: { id: bbMovement.id } })
  })

  it("listDispensableMedicines is scoped to the caller's own branch", async () => {
    const own = await createMedicineDirect({ name: "Own Dispensable Med", currentStock: 10 })

    const ids = (await listDispensableMedicines(clinicAdmin)).map((m) => m.id)
    expect(ids).toContain(own.id) // positive control
    expect(ids).not.toContain(siblingMeds.ledger.id)
    expect(ids).not.toContain(siblingMeds.low.id)
    expect(ids).not.toContain(branchBMeds.plain.id)
    expect(ids).not.toContain(branchBMeds.low.id)

    // Positive control from the other side: those rows are dispensable to
    // the branches that own them, so their absence above is the branch
    // filter and not the isActive/expiry filters quietly dropping them.
    const siblingIds = (await listDispensableMedicines(siblingAdmin)).map((m) => m.id)
    expect(siblingIds).toContain(siblingMeds.ledger.id)
    expect(siblingIds).toContain(siblingMeds.low.id)
    expect(siblingIds).not.toContain(own.id)

    const branchBIds = (await listDispensableMedicines(branchBAdmin)).map((m) => m.id)
    expect(branchBIds).toContain(branchBMeds.plain.id)
    expect(branchBIds).not.toContain(own.id)
    expect(branchBIds).not.toContain(siblingMeds.ledger.id)
  })
})
