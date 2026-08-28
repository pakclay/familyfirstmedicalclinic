import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { Role, Sex, MedicineForm, MedicineUnit } from "@prisma/client"
import { superuserPrisma } from "@/lib/test/superuser-prisma"
import { prisma } from "@/lib/db/prisma"
import {
  saveConsultation,
  InsufficientStockError,
  listPatientConsultationHistory,
  getConsultationScreenData,
} from "@/lib/queries/consultations"
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
  let branch: { id: string; timezone: string }
  let doctorUser: AbilitySubject
  let doctorId: string
  let patient: { id: string }
  let stockedMedicine: { id: string; name: string }
  let lowStockMedicine: { id: string }

  async function createQueueEntry(status: "CALLED" | "IN_CONSULTATION" = "CALLED") {
    return superuserPrisma.queueEntry.create({
      data: {
        branchId: branch.id,
        patientId: patient.id,
        doctorId,
        queueNumber: Math.floor(Math.random() * 100000) + 1,
        queueDate: todayAsQueueDate(branch.timezone),
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
      data: { holdingCompanyId: holding.id, name: "Consult Test Clinic" },
    })
    const branchRow = await superuserPrisma.branch.create({
      data: {
        clinicId: clinicRow.id,
        name: "Consult Test Branch",
        slug: `consult-test-${Date.now()}`,
        address: "1 Test St",
        city: "Test City",
        phone: "0000",
        timezone: "Asia/Manila",
        operatingHours: {},
      },
    })
    branch = { id: branchRow.id, timezone: branchRow.timezone }

    const docUser = await superuserPrisma.user.create({
      data: { branchId: branch.id, name: "Dr. Consult", email: `dr-consult-${Date.now()}@test.local`, passwordHash: "x", role: Role.DOCTOR },
    })
    const doctor = await superuserPrisma.doctor.create({
      data: { userId: docUser.id, branchId: branch.id, licenseNumber: "C1", consultationFee: 50000 },
    })
    doctorId = doctor.id
    doctorUser = { id: docUser.id, role: Role.DOCTOR, branchId: branch.id, holdingCompanyId: null }

    patient = await superuserPrisma.patient.create({
      data: {
        branchId: branch.id,
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
        branchId: branch.id,
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
        branchId: branch.id,
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
    await superuserPrisma.auditLog.deleteMany({ where: { branchId: branch.id } })
    await superuserPrisma.medicineDispensed.deleteMany({ where: { branchId: branch.id } })
    await superuserPrisma.payment.deleteMany({ where: { branchId: branch.id } })
    await superuserPrisma.consultation.deleteMany({ where: { branchId: branch.id } })
    await superuserPrisma.stockMovement.deleteMany({ where: { branchId: branch.id } })
    await superuserPrisma.queueEntry.deleteMany({ where: { branchId: branch.id } })
    await superuserPrisma.medicine.update({ where: { id: stockedMedicine.id }, data: { currentStock: 24 } })
    await superuserPrisma.medicine.update({ where: { id: lowStockMedicine.id }, data: { currentStock: 3 } })
  })

  afterAll(async () => {
    await superuserPrisma.medicine.deleteMany({ where: { branchId: branch.id } })
    await superuserPrisma.patient.deleteMany({ where: { branchId: branch.id } })
    await superuserPrisma.doctor.deleteMany({ where: { branchId: branch.id } })
    await superuserPrisma.user.deleteMany({ where: { branchId: branch.id } })
    const { clinicId } = await superuserPrisma.branch.findUniqueOrThrow({ where: { id: branch.id }, select: { clinicId: true } })
    await superuserPrisma.branch.delete({ where: { id: branch.id } })
    await superuserPrisma.clinic.delete({ where: { id: clinicId } })
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

    const dispensed = await superuserPrisma.medicineDispensed.findFirst({ where: { branchId: branch.id }, orderBy: { createdAt: "desc" } })
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
      data: { branchId: branch.id, name: "Dr. Other", email: `dr-other-${Date.now()}@test.local`, passwordHash: "x", role: Role.DOCTOR },
    })
    const otherDoctor = await superuserPrisma.doctor.create({
      data: { userId: otherDocUser.id, branchId: branch.id, licenseNumber: "C2", consultationFee: 50000 },
    })
    const otherDoctorSubject: AbilitySubject = { id: otherDocUser.id, role: Role.DOCTOR, branchId: branch.id, holdingCompanyId: null }

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

/**
 * Branch isolation for the consultation module — the boundary the Branch
 * tier introduced and that the suite above proves nothing about (it runs
 * on a single holding / single clinic / single branch, and its one
 * ForbiddenError case is a same-branch *doctor-ownership* check).
 *
 * The fixture below is the patients.test.ts shape: ONE holding, TWO
 * clinics, and THREE branches — branchA, branchB (the cross-clinic
 * control), and siblingOfA, which sits under the SAME CLINIC as branchA.
 * siblingOfA is the whole point: no cross-*clinic* fixture can catch a
 * regression that leaks between two branches of one clinic.
 *
 * Both enforcement layers are covered separately: the app-layer branch
 * predicate in lib/queries/consultations.ts, and the Postgres RLS
 * backstop (prisma/migrations/20260824000004_branch_rewrite_rls_policies)
 * exercised directly through the RLS-enforced `prisma` client.
 *
 * Every foreign queue entry below is deliberately assigned to *this*
 * caller's own doctor id, so the branch predicate is the ONLY thing that
 * can refuse it — if the `branchId` were dropped from the where-clause,
 * the doctor-ownership check would wave the row straight through and
 * these tests would fail loudly instead of passing for the wrong reason.
 */
describe("branch scoping — consultations", () => {
  // Module-specific literal prefix: other test files run against this same
  // database and share the unique slug/token indexes.
  const PREFIX = "consult-iso"
  const stamp = Date.now()
  // Unique within *our own* branches, which is all `@@unique([branchId,
  // queueDate, queueNumber])` requires.
  let queueSeq = Math.floor(Math.random() * 500_000) + 1

  const OWN_HISTORY_DIAGNOSIS = `${PREFIX}-OWN-BRANCH-HISTORY-CONTROL`
  const SIBLING_HISTORY_DIAGNOSIS = `${PREFIX}-SIBLING-BRANCH-PHI-CANARY`
  const SIBLING_DISPENSED_NAME = `${PREFIX}-SIBLING-CANARY-AMOXICILLIN`

  let holdingId: string
  let clinicAId: string
  let clinicBId: string
  let branchA: { id: string; timezone: string }
  let branchB: { id: string; timezone: string }
  let siblingOfA: { id: string; timezone: string }

  let doctorAId: string
  let doctorA: AbilitySubject
  let holdingAdmin: AbilitySubject

  let patientA: { id: string }
  let patientB: { id: string }
  let patientInSibling: { id: string }

  let medicineA: { id: string; name: string }
  let medicineInSibling: { id: string; name: string }

  let ownEntry: { id: string }
  let entryInOtherClinic: { id: string }
  let siblingEntry: { id: string }

  let siblingHistoryEntry: { id: string }
  let ownHistoryConsultation: { id: string }
  let siblingHistoryConsultation: { id: string }
  let siblingDispensed: { id: string }

  async function createEntry(branchId: string, patientId: string, timezone: string) {
    return superuserPrisma.queueEntry.create({
      data: {
        branchId,
        patientId,
        doctorId: doctorAId,
        queueNumber: queueSeq++,
        queueDate: todayAsQueueDate(timezone),
        status: "CALLED",
        source: "WALK_IN",
        checkedInAt: new Date(),
        calledAt: new Date(),
        accessToken: `${PREFIX}-${stamp}-${queueSeq}-${Math.random().toString(36).slice(2)}`,
      },
    })
  }

  beforeAll(async () => {
    const holding = await superuserPrisma.holdingCompany.create({ data: { name: `Consult Iso Holding ${stamp}` } })
    holdingId = holding.id
    const clinicA = await superuserPrisma.clinic.create({
      data: { holdingCompanyId: holding.id, name: "Consult Iso Clinic A" },
    })
    const clinicB = await superuserPrisma.clinic.create({
      data: { holdingCompanyId: holding.id, name: "Consult Iso Clinic B" },
    })
    clinicAId = clinicA.id
    clinicBId = clinicB.id

    const mkBranch = async (clinicId: string, name: string, slug: string) =>
      superuserPrisma.branch.create({
        data: {
          clinicId,
          name,
          slug,
          address: "1 Test St",
          city: "Test City",
          phone: "0000",
          timezone: "Asia/Manila",
          operatingHours: {},
        },
      })

    branchA = await mkBranch(clinicA.id, "Consult Iso Branch A", `${PREFIX}-a-${stamp}`)
    branchB = await mkBranch(clinicB.id, "Consult Iso Branch B", `${PREFIX}-b-${stamp}`)
    // Same clinic as branchA — the new boundary.
    siblingOfA = await mkBranch(clinicA.id, "Consult Iso Branch A sibling", `${PREFIX}-a-sibling-${stamp}`)

    const docUserA = await superuserPrisma.user.create({
      data: {
        branchId: branchA.id,
        name: "Dr. Iso A",
        email: `${PREFIX}-dr-a-${stamp}@test.local`,
        passwordHash: "x",
        role: Role.DOCTOR,
      },
    })
    const doctorRowA = await superuserPrisma.doctor.create({
      data: { userId: docUserA.id, branchId: branchA.id, licenseNumber: `${PREFIX}-L1`, consultationFee: 50000 },
    })
    doctorAId = doctorRowA.id
    doctorA = { id: docUserA.id, role: Role.DOCTOR, branchId: branchA.id, holdingCompanyId: null }

    const holdingUser = await superuserPrisma.user.create({
      data: {
        holdingCompanyId: holding.id,
        name: "Iso Holding Admin",
        email: `${PREFIX}-holding-${stamp}@test.local`,
        passwordHash: "x",
        role: Role.HOLDING_ADMIN,
      },
    })
    holdingAdmin = { id: holdingUser.id, role: Role.HOLDING_ADMIN, branchId: null, holdingCompanyId: holding.id }

    const mkPatient = async (branchId: string, firstName: string, lastName: string) =>
      superuserPrisma.patient.create({
        data: {
          branchId,
          firstName,
          lastName,
          birthdate: new Date("1990-01-01"),
          sex: Sex.FEMALE,
          phone: "+63 917 000 0000",
          address: "addr",
          emergencyContactName: "ec",
          emergencyContactPhone: "+63 917 000 0001",
        },
      })

    patientA = await mkPatient(branchA.id, "Iso", "PatientA")
    patientB = await mkPatient(branchB.id, "Iso", "PatientB")
    patientInSibling = await mkPatient(siblingOfA.id, "Iso", "PatientSibling")

    medicineA = await superuserPrisma.medicine.create({
      data: {
        branchId: branchA.id,
        name: `${PREFIX}-Own Paracetamol`,
        form: MedicineForm.TABLET,
        strength: "500mg",
        unit: MedicineUnit.PIECE,
        currentStock: 40,
        reorderLevel: 5,
        unitCost: 100,
        sellingPrice: 300,
      },
    })
    medicineInSibling = await superuserPrisma.medicine.create({
      data: {
        branchId: siblingOfA.id,
        name: `${PREFIX}-Sibling Amoxicillin`,
        form: MedicineForm.CAPSULE,
        strength: "500mg",
        unit: MedicineUnit.PIECE,
        currentStock: 99,
        reorderLevel: 5,
        unitCost: 200,
        sellingPrice: 500,
      },
    })

    ownEntry = await createEntry(branchA.id, patientA.id, branchA.timezone)
    entryInOtherClinic = await createEntry(branchB.id, patientB.id, branchB.timezone)
    siblingEntry = await createEntry(siblingOfA.id, patientInSibling.id, siblingOfA.timezone)

    // The caller's own real history row — the positive control that keeps
    // every "the sibling row is absent" assertion below honest.
    const ownHistoryEntry = await createEntry(branchA.id, patientA.id, branchA.timezone)
    ownHistoryConsultation = await superuserPrisma.consultation.create({
      data: {
        queueEntryId: ownHistoryEntry.id,
        patientId: patientA.id,
        doctorId: doctorAId,
        branchId: branchA.id,
        chiefComplaint: "Own branch prior visit",
        diagnosis: OWN_HISTORY_DIAGNOSIS,
      },
    })

    // The canary for consultations.ts:42-50 — a consultation for the SAME
    // patient id the caller is allowed to see, but written into the
    // sibling branch. Written with superuserPrisma because the app itself
    // refuses to create such a row. Its doctorId is deliberately the
    // caller's own doctor so that the consultations RLS policy is the one
    // and only thing that can hide it. It hangs off its own sibling queue
    // entry so that `siblingEntry` stays consultation-free — the
    // saveConsultation test below counts rows on that entry.
    siblingHistoryEntry = await createEntry(siblingOfA.id, patientInSibling.id, siblingOfA.timezone)
    siblingHistoryConsultation = await superuserPrisma.consultation.create({
      data: {
        queueEntryId: siblingHistoryEntry.id,
        patientId: patientA.id,
        doctorId: doctorAId,
        branchId: siblingOfA.id,
        chiefComplaint: "Sibling branch visit",
        diagnosis: SIBLING_HISTORY_DIAGNOSIS,
      },
    })
    siblingDispensed = await superuserPrisma.medicineDispensed.create({
      data: {
        consultationId: siblingHistoryConsultation.id,
        branchId: siblingOfA.id,
        medicineId: medicineInSibling.id,
        medicineName: SIBLING_DISPENSED_NAME,
        dosage: "1 cap TID",
        quantity: 21,
        instructions: "sibling-branch prescription",
      },
    })
  })

  afterAll(async () => {
    const branchIds = [branchA.id, branchB.id, siblingOfA.id]
    await superuserPrisma.auditLog.deleteMany({ where: { branchId: { in: branchIds } } })
    await superuserPrisma.medicineDispensed.deleteMany({ where: { branchId: { in: branchIds } } })
    await superuserPrisma.payment.deleteMany({ where: { branchId: { in: branchIds } } })
    await superuserPrisma.consultation.deleteMany({ where: { branchId: { in: branchIds } } })
    await superuserPrisma.stockMovement.deleteMany({ where: { branchId: { in: branchIds } } })
    await superuserPrisma.queueEntry.deleteMany({ where: { branchId: { in: branchIds } } })
    await superuserPrisma.medicine.deleteMany({ where: { branchId: { in: branchIds } } })
    await superuserPrisma.patient.deleteMany({ where: { branchId: { in: branchIds } } })
    await superuserPrisma.doctor.deleteMany({ where: { branchId: { in: branchIds } } })
    await superuserPrisma.user.deleteMany({ where: { branchId: { in: branchIds } } })
    await superuserPrisma.user.deleteMany({ where: { id: holdingAdmin.id } })
    await superuserPrisma.branch.deleteMany({ where: { id: { in: branchIds } } })
    await superuserPrisma.clinic.deleteMany({ where: { id: { in: [clinicAId, clinicBId] } } })
    await superuserPrisma.holdingCompany.deleteMany({ where: { id: holdingId } })
    await superuserPrisma.$disconnect()
    await prisma.$disconnect()
  })

  it("opens the consultation screen for a queue entry in the caller's own branch (positive control)", async () => {
    const data = await getConsultationScreenData(doctorA, ownEntry.id)

    expect(data.queueEntryId).toBe(ownEntry.id)
    expect(data.patient.id).toBe(patientA.id)
    // the picker only offers this branch's stock
    expect(data.medicines.map((m) => m.id)).toContain(medicineA.id)
    expect(data.medicines.map((m) => m.id)).not.toContain(medicineInSibling.id)
  })

  it("403s getConsultationScreenData for a queue entry in another CLINIC's branch", async () => {
    await expect(getConsultationScreenData(doctorA, entryInOtherClinic.id)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("403s getConsultationScreenData for a SAME-CLINIC SIBLING branch's queue entry — sharing a parent buys no access", async () => {
    await expect(getConsultationScreenData(doctorA, siblingEntry.id)).rejects.toBeInstanceOf(ForbiddenError)
    // The branch predicate is what refused it, not the doctor-ownership
    // check further down (siblingEntry is assigned to this very doctor).
    await expect(getConsultationScreenData(doctorA, siblingEntry.id)).rejects.toThrow(/not found in your branch/i)
  })

  it("403s saveConsultation against a sibling branch's queue entry and writes nothing before throwing", async () => {
    await expect(
      saveConsultation(doctorA, siblingEntry.id, {
        chiefComplaint: "attempted cross-branch write",
        medicines: [],
        payment: { amount: 12345, method: "CASH" },
      })
    ).rejects.toBeInstanceOf(ForbiddenError)

    // Nothing was written before the throw.
    expect(await superuserPrisma.consultation.count({ where: { queueEntryId: siblingEntry.id } })).toBe(0)
    expect(await superuserPrisma.payment.count({ where: { branchId: siblingOfA.id } })).toBe(0)
    const siblingEntryAfter = await superuserPrisma.queueEntry.findUniqueOrThrow({ where: { id: siblingEntry.id } })
    expect(siblingEntryAfter.status).toBe("CALLED") // not completed

    // Positive control: the identical call against the caller's OWN queue
    // entry does save — so the refusal above is about the branch, not
    // about saveConsultation being broken for everyone.
    const ok = await createEntry(branchA.id, patientA.id, branchA.timezone)
    const saved = await saveConsultation(doctorA, ok.id, {
      chiefComplaint: "own branch save",
      medicines: [],
      payment: { amount: 12345, method: "CASH" },
    })
    expect(await superuserPrisma.consultation.count({ where: { id: saved.consultationId } })).toBe(1)
  })

  it("refuses to dispense from a SIBLING branch's medicine stock, leaving that stock and its ledger untouched", async () => {
    const entry = await createEntry(branchA.id, patientA.id, branchA.timezone)

    const err = await saveConsultation(doctorA, entry.id, {
      chiefComplaint: "cross-branch dispense attempt",
      medicines: [
        { medicineId: medicineInSibling.id, medicineName: medicineInSibling.name, quantity: 5, dispensedFromStock: true },
      ],
      payment: { amount: 50000, method: "CASH" },
    }).catch((e: unknown) => e)

    // A medicine the caller cannot see reads as simply not found, so it
    // lands on the shortfall/InsufficientStockError path rather than a
    // 403 — the property that matters is that no sibling stock moves.
    expect(err).toBeInstanceOf(InsufficientStockError)
    expect((err as InsufficientStockError).shortfalls).toEqual([
      { medicineName: "Unknown medicine", requested: 5, available: 0 },
    ])

    const siblingMedicineAfter = await superuserPrisma.medicine.findUniqueOrThrow({ where: { id: medicineInSibling.id } })
    expect(siblingMedicineAfter.currentStock).toBe(99) // unchanged
    expect(await superuserPrisma.stockMovement.count({ where: { medicineId: medicineInSibling.id } })).toBe(0)
    expect(await superuserPrisma.consultation.count({ where: { queueEntryId: entry.id } })).toBe(0)

    // Positive control: the same shape of request against the caller's OWN
    // medicine dispenses normally, so the block above is about the branch,
    // not about dispensing being broken.
    const okEntry = await createEntry(branchA.id, patientA.id, branchA.timezone)
    await saveConsultation(doctorA, okEntry.id, {
      chiefComplaint: "own branch dispense",
      medicines: [{ medicineId: medicineA.id, medicineName: medicineA.name, quantity: 5, dispensedFromStock: true }],
      payment: { amount: 50000, method: "CASH" },
    })
    const ownMedicineAfter = await superuserPrisma.medicine.findUniqueOrThrow({ where: { id: medicineA.id } })
    expect(ownMedicineAfter.currentStock).toBe(35) // 40 - 5
    expect(await superuserPrisma.stockMovement.count({ where: { medicineId: medicineA.id } })).toBe(1)
  })

  it("REGRESSION ALARM: the unguarded prior-history query does not surface a sibling branch's consultation for the same patient", async () => {
    // consultations.ts:42-50 fetches prior history with
    // `where: { patientId, deletedAt: null }` and NO branch predicate at
    // all — its isolation rests SOLELY on the Postgres RLS policy on
    // "consultations". If that policy is ever dropped, weakened, or the
    // query is moved off the RLS-scoped client, this is the test that
    // catches it: the fixture holds a consultation for patientA that was
    // written into siblingOfA, and it must not appear in branchA's screen.
    const data = await getConsultationScreenData(doctorA, ownEntry.id)

    const ids = data.history.map((c) => c.id)
    const diagnoses = data.history.map((c) => c.diagnosis)

    expect(ids).not.toContain(siblingHistoryConsultation.id)
    expect(diagnoses).not.toContain(SIBLING_HISTORY_DIAGNOSIS)
    // Positive control — an empty/blank history would satisfy the two
    // assertions above just as well.
    expect(ids).toContain(ownHistoryConsultation.id)
    expect(diagnoses).toContain(OWN_HISTORY_DIAGNOSIS)
  })

  it("RLS backstop: consultations — an unfiltered query under Branch A's session context cannot see the sibling branch's consultation", async () => {
    const hidden = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.role', ${Role.DOCTOR}, true)`
      await tx.$executeRaw`SELECT set_config('app.user_id', ${doctorA.id}, true)`
      await tx.$executeRaw`SELECT set_config('app.branch_id', ${branchA.id}, true)`
      // deliberately unfiltered by branch — proves the DB hides the row
      return tx.consultation.findMany({ where: { id: siblingHistoryConsultation.id } })
    })
    expect(hidden).toHaveLength(0)

    // Positive control: identical query, identical code path, only
    // app.branch_id differs — this passing is what proves the policy is
    // keyed on app.branch_id rather than simply blocking everything.
    const visible = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.role', ${Role.DOCTOR}, true)`
      await tx.$executeRaw`SELECT set_config('app.user_id', ${doctorA.id}, true)`
      await tx.$executeRaw`SELECT set_config('app.branch_id', ${siblingOfA.id}, true)`
      return tx.consultation.findMany({ where: { id: siblingHistoryConsultation.id } })
    })
    expect(visible).toHaveLength(1)
    expect(visible[0]?.diagnosis).toBe(SIBLING_HISTORY_DIAGNOSIS)
  })

  it("RLS backstop: medicines_dispensed — prescription PHI from the sibling branch is hidden at the database layer", async () => {
    const hidden = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.role', ${Role.DOCTOR}, true)`
      await tx.$executeRaw`SELECT set_config('app.user_id', ${doctorA.id}, true)`
      await tx.$executeRaw`SELECT set_config('app.branch_id', ${branchA.id}, true)`
      return tx.medicineDispensed.findMany({ where: { id: siblingDispensed.id } })
    })
    expect(hidden).toHaveLength(0)

    const visible = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.role', ${Role.DOCTOR}, true)`
      await tx.$executeRaw`SELECT set_config('app.user_id', ${doctorA.id}, true)`
      await tx.$executeRaw`SELECT set_config('app.branch_id', ${siblingOfA.id}, true)`
      return tx.medicineDispensed.findMany({ where: { id: siblingDispensed.id } })
    })
    expect(visible).toHaveLength(1)
    expect(visible[0]?.medicineName).toBe(SIBLING_DISPENSED_NAME)
  })

  it("listPatientConsultationHistory excludes the sibling branch's consultation for the same patient", async () => {
    const history = await listPatientConsultationHistory(doctorA, patientA.id)

    expect(history.map((c) => c.id)).not.toContain(siblingHistoryConsultation.id)
    expect(history.map((c) => c.diagnosis)).not.toContain(SIBLING_HISTORY_DIAGNOSIS)
    // Positive control
    expect(history.map((c) => c.id)).toContain(ownHistoryConsultation.id)
  })

  it("listPatientConsultationHistory returns [] — not a throw — for a patient in another branch", async () => {
    // Asserting what the code ACTUALLY does today: consultations.ts:96
    // filters by branchId rather than throwing, so a foreign patientId
    // yields an empty list. The property under test is that no row
    // crosses, not the shape of the refusal.
    await expect(listPatientConsultationHistory(doctorA, patientB.id)).resolves.toEqual([])
    await expect(listPatientConsultationHistory(doctorA, patientInSibling.id)).resolves.toEqual([])

    // Positive control: the same call for the caller's own patient is not empty.
    const own = await listPatientConsultationHistory(doctorA, patientA.id)
    expect(own.length).toBeGreaterThan(0)
  })

  it("a holding admin still reads across branches — the HOLDING_ADMIN arm is not over-tightened", async () => {
    const history = await listPatientConsultationHistory(holdingAdmin, patientA.id)

    expect(history.map((c) => c.id)).toContain(ownHistoryConsultation.id)
    expect(history.map((c) => c.id)).toContain(siblingHistoryConsultation.id)
  })
})
