import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { prisma } from "@/lib/db/prisma"
import { runWithRls } from "@/lib/db/rls"
import { superuserPrisma } from "@/lib/test/superuser-prisma"
import { createPatientRecordFor } from "../patients"
import {
  createAssessmentFor,
  listDoctorQueueFor,
  createPrescriptionFor,
  signPrescriptionFor,
  createCarePlanFor,
} from "../clinical"
import { ForbiddenError } from "@/lib/permissions/errors"
import type { AbilitySubject } from "@/lib/permissions/ability"

// §6: "Wellness clients never touch the doctor queue" + "An injury case
// flows PT -> doctor -> care plan" (Phase 4's literal "done when").

const owner: AbilitySubject = { role: "OWNER", id: "test-owner-clinical", homeBranchId: null }

let branch: { id: string }
let therapistId: string
let doctorId: string
let serviceId: string

function subject(overrides: Partial<AbilitySubject>): AbilitySubject {
  return { role: "THERAPIST", id: "x", homeBranchId: null, ...overrides }
}

beforeAll(async () => {
  branch = await prisma.branch.upsert({
    where: { code: "TEST-P4" },
    update: {},
    create: { code: "TEST-P4", name: "Phase 4 Test Branch", address: "", city: "", province: "", phone: "", openingHours: {} },
  })
  therapistId = "test-pt-clinical"
  doctorId = "test-doc-clinical"
  const service = await prisma.service.findUniqueOrThrow({ where: { code: "R-ASSESS" } })
  serviceId = service.id
})

afterAll(async () => {
  await superuserPrisma.appointment.deleteMany({ where: { branchId: branch.id } })
  await superuserPrisma.carePlan.deleteMany({ where: { patient: { homeBranchId: branch.id } } })
  await superuserPrisma.prescription.deleteMany({ where: { patient: { homeBranchId: branch.id } } })
  await superuserPrisma.assessment.deleteMany({ where: { branchId: branch.id } })
  await superuserPrisma.patientConsent.deleteMany({ where: { patient: { homeBranchId: branch.id } } })
  await superuserPrisma.patient.deleteMany({ where: { homeBranchId: branch.id } })
  await superuserPrisma.branch.deleteMany({ where: { id: branch.id } })
  await superuserPrisma.$disconnect()
  await prisma.$disconnect()
})

/** §6: the PT sees a patient's chart via the appointment for their first
 * visit, before any care plan (and thus primaryTherapistId) exists — see
 * requireReadScope() in patients.ts. Stands in for Phase 3's full booking
 * flow, which isn't this test's concern. */
async function bookInitialVisit(patientId: string, therapistIdToLink: string) {
  const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
  await prisma.appointment.create({
    data: {
      patientId,
      branchId: branch.id,
      therapistId: therapistIdToLink,
      serviceId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
      source: "WALK_IN",
    },
  })
}

async function makePatient(mobile: string) {
  return createPatientRecordFor(owner, {
    firstName: "Clinical",
    lastName: "Test",
    birthDate: "1990-01-01",
    sex: "MALE",
    mobile,
    address: "1 Test St.",
    city: "San Fernando",
    province: "Pampanga",
    emergencyContactName: "EC",
    emergencyContactPhone: "09170000099",
    consentTreatment: true,
    consentDataPrivacy: true,
    consentMarketing: false,
    consentPhoto: false,
    homeBranchId: branch.id,
  })
}

describe("wellness clients never touch the doctor queue", () => {
  it("a WELLNESS assessment never appears in the doctor queue", async () => {
    const patient = await makePatient("09170001001")
    await bookInitialVisit(patient.id, therapistId)
    const therapist = subject({ role: "THERAPIST", id: therapistId, homeBranchId: branch.id })

    await createAssessmentFor(therapist, {
      patientId: patient.id,
      branchId: branch.id,
      track: "WELLNESS",
      chiefComplaint: "Wants a recovery session",
      painScale: 0,
      recommendation: "Proceed with wellness recovery",
    })

    const doctor = subject({ role: "DOCTOR", id: doctorId, homeBranchId: branch.id })
    const queue = await listDoctorQueueFor(doctor)
    expect(queue.some((a) => a.patientId === patient.id)).toBe(false)
  })

  it("a REHAB assessment does appear in the doctor queue", async () => {
    const patient = await makePatient("09170001002")
    await bookInitialVisit(patient.id, therapistId)
    const therapist = subject({ role: "THERAPIST", id: therapistId, homeBranchId: branch.id })

    const assessment = await createAssessmentFor(therapist, {
      patientId: patient.id,
      branchId: branch.id,
      track: "REHAB",
      chiefComplaint: "Ankle sprain from basketball",
      painScale: 6,
      mechanismOfInjury: "Rolled ankle landing from a jump",
      recommendation: "Refer to doctor for diagnosis",
    })

    const doctor = subject({ role: "DOCTOR", id: doctorId, homeBranchId: branch.id })
    const queue = await listDoctorQueueFor(doctor)
    expect(queue.some((a) => a.id === assessment.id)).toBe(true)
  })
})

describe("an injury case flows PT -> doctor -> care plan", () => {
  it("REHAB assessment -> signed prescription -> care plan assigns primaryTherapistId", async () => {
    const patient = await makePatient("09170001003")
    await bookInitialVisit(patient.id, therapistId)
    const therapist = subject({ role: "THERAPIST", id: therapistId, homeBranchId: branch.id })
    const doctor = subject({ role: "DOCTOR", id: doctorId, homeBranchId: branch.id })

    const assessment = await createAssessmentFor(therapist, {
      patientId: patient.id,
      branchId: branch.id,
      track: "REHAB",
      chiefComplaint: "Lower back pain",
      painScale: 7,
      recommendation: "Refer to doctor",
    })

    // A DRAFT prescription doesn't satisfy the completion gate or let a
    // care plan start yet.
    const draft = await createPrescriptionFor(doctor, {
      patientId: patient.id,
      assessmentId: assessment.id,
      diagnosis: "Lumbar strain",
      prescribedSessions: 8,
      frequencyPerWeek: 2,
      validFrom: "2026-01-01",
      validUntil: "2026-06-01",
    })
    await expect(
      createCarePlanFor(doctor, {
        patientId: patient.id,
        track: "REHAB",
        prescriptionId: draft.id,
        totalSessions: 8,
        assignedTherapistId: therapistId,
      })
    ).rejects.toThrow(/hasn't been signed/)

    const signed = await signPrescriptionFor(doctor, draft.id)
    expect(signed.status).toBe("SIGNED")

    await createCarePlanFor(doctor, {
      patientId: patient.id,
      track: "REHAB",
      prescriptionId: signed.id,
      totalSessions: signed.prescribedSessions,
      assignedTherapistId: therapistId,
    })

    const updatedPatient = await runWithRls(owner, (tx) => tx.patient.findUniqueOrThrow({ where: { id: patient.id } }))
    expect(updatedPatient.primaryTherapistId).toBe(therapistId)

    const auditRows = await prisma.auditLog.findMany({
      where: { entityType: "Patient", entityId: patient.id, action: "ASSIGN_PRIMARY_THERAPIST" },
    })
    expect(auditRows).toHaveLength(1)
  })

  it("MARKETING cannot write an assessment", async () => {
    const patient = await makePatient("09170001004")
    const marketing = subject({ role: "MARKETING", id: "test-mkt", homeBranchId: null })
    await expect(
      createAssessmentFor(marketing, {
        patientId: patient.id,
        branchId: branch.id,
        track: "WELLNESS",
        chiefComplaint: "x",
        painScale: 0,
        recommendation: "x",
      })
    ).rejects.toThrow(ForbiddenError)
  })
})
