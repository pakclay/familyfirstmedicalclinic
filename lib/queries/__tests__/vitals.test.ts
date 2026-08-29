import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { Role, Sex } from "@prisma/client"
import { superuserPrisma } from "@/lib/test/superuser-prisma"
import { prisma } from "@/lib/db/prisma"
import { recordVitals, getVitals } from "@/lib/queries/vitals"
import { ForbiddenError } from "@/lib/permissions/errors"
import type { AbilitySubject } from "@/lib/permissions/ability"

/**
 * Triage vitals on a queue entry. Two things carry the risk here: the
 * branch predicate, since vitals are clinical data on a table shared across
 * a whole company, and the validation, since the field this replaced
 * accepted any string at all and showed it to a doctor as fact.
 */
describe("vitals", () => {
  const stamp = Date.now()
  let branchA: { id: string }
  let siblingOfA: { id: string }
  let holdingId: string
  let frontDeskA: AbilitySubject
  let frontDeskSibling: AbilitySubject
  let doctorA: AbilitySubject
  let entryA: { id: string }
  let entryInSibling: { id: string }

  async function makeBranch(clinicId: string, name: string, slug: string) {
    return superuserPrisma.branch.create({
      data: {
        clinicId,
        name,
        slug: `${slug}-${stamp}`,
        address: "1 Vitals St",
        city: "Vitals City",
        phone: "0000",
        operatingHours: {},
      },
    })
  }

  async function makeEntry(branchId: string, patientId: string, queueNumber: number) {
    return superuserPrisma.queueEntry.create({
      data: {
        branchId,
        patientId,
        queueNumber,
        queueDate: new Date("2099-01-01T00:00:00Z"),
        status: "WAITING",
        source: "WALK_IN",
        accessToken: `vit-${stamp}-${queueNumber}`,
      },
    })
  }

  async function makePatient(branchId: string, lastName: string) {
    return superuserPrisma.patient.create({
      data: {
        branchId,
        firstName: "Vitals",
        lastName,
        birthdate: new Date("1990-01-01"),
        sex: Sex.FEMALE,
        phone: "09170000000",
        address: "1 Vitals St",
        emergencyContactName: "Kin",
        emergencyContactPhone: "09170000001",
      },
    })
  }

  beforeAll(async () => {
    const holding = await superuserPrisma.holdingCompany.create({ data: { name: `Vitals Holding ${stamp}` } })
    holdingId = holding.id
    // One clinic, two branches — the sibling boundary, which is the one a
    // clinic-level filter would wrongly let through.
    const clinic = await superuserPrisma.clinic.create({
      data: { holdingCompanyId: holding.id, name: `Vitals Clinic ${stamp}` },
    })
    branchA = await makeBranch(clinic.id, "Vitals A", "vit-a")
    siblingOfA = await makeBranch(clinic.id, "Vitals Sibling", "vit-sib")

    const fdA = await superuserPrisma.user.create({
      data: {
        branchId: branchA.id,
        name: "Vitals Front Desk A",
        email: `vit-fd-a-${stamp}@test.local`,
        passwordHash: "x",
        role: Role.FRONT_DESK,
      },
    })
    frontDeskA = { id: fdA.id, role: Role.FRONT_DESK, branchId: branchA.id, holdingCompanyId: null }

    const fdSib = await superuserPrisma.user.create({
      data: {
        branchId: siblingOfA.id,
        name: "Vitals Front Desk Sibling",
        email: `vit-fd-sib-${stamp}@test.local`,
        passwordHash: "x",
        role: Role.FRONT_DESK,
      },
    })
    frontDeskSibling = { id: fdSib.id, role: Role.FRONT_DESK, branchId: siblingOfA.id, holdingCompanyId: null }

    const docUser = await superuserPrisma.user.create({
      data: {
        branchId: branchA.id,
        name: "Vitals Dr A",
        email: `vit-dr-a-${stamp}@test.local`,
        passwordHash: "x",
        role: Role.DOCTOR,
      },
    })
    doctorA = { id: docUser.id, role: Role.DOCTOR, branchId: branchA.id, holdingCompanyId: null }

    const patientA = await makePatient(branchA.id, "PatientA")
    const patientSib = await makePatient(siblingOfA.id, "PatientSib")
    entryA = await makeEntry(branchA.id, patientA.id, 8001)
    entryInSibling = await makeEntry(siblingOfA.id, patientSib.id, 8002)
  })

  afterAll(async () => {
    const branchIds = [branchA.id, siblingOfA.id]
    await superuserPrisma.auditLog.deleteMany({ where: { branchId: { in: branchIds } } })
    await superuserPrisma.queueEntry.deleteMany({ where: { branchId: { in: branchIds } } })
    await superuserPrisma.patient.deleteMany({ where: { branchId: { in: branchIds } } })
    await superuserPrisma.user.deleteMany({ where: { branchId: { in: branchIds } } })
    await superuserPrisma.branch.deleteMany({ where: { id: { in: branchIds } } })
    await superuserPrisma.clinic.deleteMany({ where: { holdingCompanyId: holdingId } })
    await superuserPrisma.holdingCompany.deleteMany({ where: { id: holdingId } })
    await superuserPrisma.$disconnect()
    await prisma.$disconnect()
  })

  it("lets front desk record vitals, stamping who took them and when", async () => {
    const result = await recordVitals(frontDeskA, entryA.id, {
      temp: "37.2",
      weight: "62.5",
      height: "165",
      pulse: "78",
      bp: "120/80",
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.vitals.vitals).toEqual({ temp: "37.2", weight: "62.5", height: "165", pulse: "78", bp: "120/80" })
    expect(result.vitals.recordedByName).toBe("Vitals Front Desk A")
    expect(result.vitals.recordedAt).toBeInstanceOf(Date)

    const row = await superuserPrisma.queueEntry.findUniqueOrThrow({ where: { id: entryA.id } })
    expect(row.vitalsRecordedById).toBe(frontDeskA.id)
  })

  it("lets a doctor record them too, and a clinic admin", async () => {
    expect((await recordVitals(doctorA, entryA.id, { temp: "37.0" })).ok).toBe(true)
    const clinicAdmin: AbilitySubject = { ...frontDeskA, role: Role.CLINIC_ADMIN }
    expect((await recordVitals(clinicAdmin, entryA.id, { pulse: "70" })).ok).toBe(true)
  })

  it("drops blank fields rather than storing them as empty strings", async () => {
    const result = await recordVitals(frontDeskA, entryA.id, { temp: "36.8", weight: "", height: "  ", pulse: "72" })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.vitals.vitals).toEqual({ temp: "36.8", pulse: "72" })
    expect(Object.keys(result.vitals.vitals)).not.toContain("weight")
  })

  it("refuses a save with nothing filled in", async () => {
    const before = await superuserPrisma.queueEntry.findUniqueOrThrow({ where: { id: entryA.id } })
    const result = await recordVitals(frontDeskA, entryA.id, { temp: "", weight: "", height: "", pulse: "", bp: "" })
    expect(result).toEqual({ ok: false, error: "Enter at least one measurement." })
    // An empty save would stamp a recorder and a timestamp onto a reading
    // that does not exist, which reads as "vitals were taken".
    const after = await superuserPrisma.queueEntry.findUniqueOrThrow({ where: { id: entryA.id } })
    expect(after.vitalsRecordedAt).toEqual(before.vitalsRecordedAt)
  })

  it("rejects implausible measurements instead of storing them verbatim", async () => {
    // The field this replaces accepted any string at all, so a mistyped
    // temperature was shown to the doctor as fact.
    for (const [input, fragment] of [
      [{ temp: "999" }, "Temperature must be between"],
      [{ temp: "hot" }, "Temperature must be a number"],
      [{ weight: "700" }, "Weight must be between"],
      [{ height: "1.7" }, "Height must be between"],
      [{ pulse: "5" }, "Pulse must be between"],
      [{ bp: "very high" }, "Blood pressure looks like"],
    ] as const) {
      const result = await recordVitals(frontDeskA, entryA.id, input)
      expect(result.ok).toBe(false)
      if (result.ok) continue
      expect(result.error).toContain(fragment)
    }
  })

  it("accepts the edges of each plausible range", async () => {
    // The positive control for the test above: a validator that rejected
    // everything would satisfy it just as well.
    const result = await recordVitals(frontDeskA, entryA.id, {
      temp: "35",
      weight: "3.2",
      height: "48",
      pulse: "45",
      bp: "90/60",
    })
    expect(result.ok).toBe(true)
  })

  it("403s recording vitals onto a sibling branch's queue entry, and writes nothing", async () => {
    await expect(recordVitals(frontDeskA, entryInSibling.id, { temp: "37" })).rejects.toBeInstanceOf(ForbiddenError)
    const row = await superuserPrisma.queueEntry.findUniqueOrThrow({ where: { id: entryInSibling.id } })
    expect(row.vitals).toBeNull()
    expect(row.vitalsRecordedAt).toBeNull()
  })

  it("403s reading a sibling branch's vitals", async () => {
    await expect(getVitals(frontDeskA, entryInSibling.id)).rejects.toBeInstanceOf(ForbiddenError)
    // Positive control: the sibling's own front desk can read them, so the
    // refusal above is a branch boundary rather than a broken query.
    const ok = await recordVitals(frontDeskSibling, entryInSibling.id, { temp: "37.4" })
    expect(ok.ok).toBe(true)
    expect((await getVitals(frontDeskSibling, entryInSibling.id)).vitals).toEqual({ temp: "37.4" })
  })

  it("refuses a role that doesn't see patients", async () => {
    const holdingAdmin: AbilitySubject = {
      id: "someone",
      role: Role.HOLDING_ADMIN,
      branchId: null,
      holdingCompanyId: holdingId,
    }
    expect(await recordVitals(holdingAdmin, entryA.id, { temp: "37" })).toEqual({
      ok: false,
      error: "Only clinic staff can record vitals.",
    })
  })

  it("audit-logs which fields were recorded, never the readings themselves", async () => {
    await recordVitals(frontDeskA, entryA.id, { temp: "38.1", pulse: "95" })
    const log = await superuserPrisma.auditLog.findFirst({
      where: { entityId: entryA.id, action: "queue_entry.vitals_recorded" },
      orderBy: { createdAt: "desc" },
    })
    expect(log).toBeTruthy()
    expect(log!.changes).toEqual({ fields: ["pulse", "temp"] })
    // Measurements are clinical data on the visit; the audit trail is read
    // by a different, wider set of people and retained far longer.
    expect(JSON.stringify(log!.changes)).not.toContain("38.1")
  })

  it("overwrites a previous reading rather than appending", async () => {
    await recordVitals(frontDeskA, entryA.id, { temp: "37.0", pulse: "80" })
    const second = await recordVitals(frontDeskA, entryA.id, { temp: "36.5" })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    // A correction replaces the reading — a stale pulse left alongside a
    // corrected temperature would be read as both having been measured.
    expect(second.vitals.vitals).toEqual({ temp: "36.5" })
  })
})
