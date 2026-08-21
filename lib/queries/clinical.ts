import { prisma } from "@/lib/db/prisma"
import { runWithRls } from "@/lib/db/rls"
import { ForbiddenError } from "@/lib/permissions/errors"
import { canAccess, type AbilitySubject } from "@/lib/permissions/ability"
import { getPatientFor } from "@/lib/queries/patients"
import type { AssessmentInput, PrescriptionInput, CarePlanInput } from "@/lib/validation/clinical"

const csvToArray = (v?: string) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

// ─────────────────────────────────────────────────────────────────────────
// Assessment — §6's PT triage step. Shares the "soapNotes" resource scope
// with SessionNote per §4.1's combined table row.
// ─────────────────────────────────────────────────────────────────────────

export async function createAssessmentFor(
  user: AbilitySubject,
  input: AssessmentInput & { patientId: string; branchId: string }
) {
  if (!canAccess(user, "soapNotes", "write")) throw new ForbiddenError("Your role cannot write assessments")
  const patient = await getPatientFor(user, input.patientId)
  if (!patient) throw new ForbiddenError("Cannot assess a patient outside your scope")

  return prisma.assessment.create({
    data: {
      patientId: input.patientId,
      branchId: input.branchId,
      assessedById: user.id,
      assessedAt: new Date(),
      track: input.track,
      chiefComplaint: input.chiefComplaint,
      painScale: input.painScale,
      painLocation: input.painLocation || null,
      onsetDate: input.onsetDate ? new Date(input.onsetDate) : null,
      mechanismOfInjury: input.mechanismOfInjury || null,
      romFindings: input.romFindings ? { notes: input.romFindings } : undefined,
      specialTests: input.specialTests ? { notes: input.specialTests } : undefined,
      redFlags: csvToArray(input.redFlags),
      recommendation: input.recommendation,
      // §6 is unconditional: "wellness clients never touch the doctor
      // queue." Not a default the PT can override in either direction —
      // REHAB is always flagged, WELLNESS never is, full stop.
      needsDoctorReview: input.track === "REHAB",
      createdById: user.id,
    },
  })
}

export async function listAssessmentsForPatient(user: AbilitySubject, patientId: string) {
  const patient = await getPatientFor(user, patientId)
  if (!patient) throw new ForbiddenError("Cannot view assessments for a patient outside your scope")
  return prisma.assessment.findMany({ where: { patientId, deletedAt: null }, orderBy: { assessedAt: "desc" } })
}

/** DOCTOR's review queue: REHAB assessments flagged for review with no
 * signed prescription yet. §6: wellness clients never appear here. */
export async function listDoctorQueueFor(user: AbilitySubject) {
  if (!canAccess(user, "prescription", "write")) {
    throw new ForbiddenError("Your role cannot access the doctor review queue")
  }
  const branchScope = user.role === "OWNER" ? {} : { branchId: user.homeBranchId ?? "__none__" }

  // The `patient` include joins to a table with RLS enabled — without a
  // GUC context, that join comes back null and Prisma throws on the
  // required relation. Same class of bug as Payment's RETURNING issue in
  // Phase 3: any query touching Patient needs runWithRls.
  return runWithRls(user, (tx) =>
    tx.assessment.findMany({
      where: {
        ...branchScope,
        needsDoctorReview: true,
        deletedAt: null,
        prescriptions: { none: { status: "SIGNED" } },
      },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, patientCode: true } },
        prescriptions: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { assessedAt: "asc" },
    })
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Prescription
// ─────────────────────────────────────────────────────────────────────────

export async function createPrescriptionFor(
  user: AbilitySubject,
  input: PrescriptionInput & { patientId: string; assessmentId: string }
) {
  if (!canAccess(user, "prescription", "write")) throw new ForbiddenError("Only a doctor can write a prescription")

  const assessment = await prisma.assessment.findUniqueOrThrow({ where: { id: input.assessmentId } })
  if (assessment.patientId !== input.patientId) throw new Error("Assessment does not belong to this patient")
  if (!assessment.needsDoctorReview) throw new Error("This assessment was not flagged for doctor review")

  return prisma.prescription.create({
    data: {
      patientId: input.patientId,
      assessmentId: input.assessmentId,
      doctorId: user.id,
      diagnosis: input.diagnosis,
      icd10: input.icd10 || null,
      prescribedSessions: input.prescribedSessions,
      frequencyPerWeek: input.frequencyPerWeek,
      modalities: csvToArray(input.modalities),
      precautions: input.precautions || null,
      goals: input.goals || null,
      validFrom: new Date(input.validFrom),
      validUntil: new Date(input.validUntil),
      status: "DRAFT",
      createdById: user.id,
    },
  })
}

/** Signing is what makes a prescription satisfy §6's completion gate — it's
 * a separate step from drafting so a doctor can review before committing. */
export async function signPrescriptionFor(user: AbilitySubject, prescriptionId: string) {
  if (!canAccess(user, "prescription", "write")) throw new ForbiddenError("Only a doctor can sign a prescription")

  const prescription = await prisma.prescription.findUniqueOrThrow({ where: { id: prescriptionId } })
  if (prescription.doctorId !== user.id && user.role !== "OWNER") {
    throw new ForbiddenError("Only the prescribing doctor (or the owner) can sign this prescription")
  }
  if (prescription.status === "SIGNED") throw new Error("Already signed")

  return prisma.prescription.update({
    where: { id: prescriptionId },
    data: { status: "SIGNED", signedAt: new Date() },
  })
}

export async function listPrescriptionsForPatient(user: AbilitySubject, patientId: string) {
  if (!canAccess(user, "prescription", "read")) throw new ForbiddenError("Your role cannot view prescriptions")
  // getPatientFor already enforces THERAPIST's "own" and BRANCH_MANAGER's
  // branch scoping correctly (and runs within runWithRls, which a
  // hand-rolled plain `prisma.patient.findUnique` here would not) —
  // reuse it instead of re-deriving the same checks.
  if (user.role === "THERAPIST" || user.role === "BRANCH_MANAGER") {
    const patient = await getPatientFor(user, patientId)
    if (!patient) throw new ForbiddenError("Cannot view prescriptions for a patient outside your scope")
  }
  return prisma.prescription.findMany({ where: { patientId, deletedAt: null }, orderBy: { createdAt: "desc" } })
}

// ─────────────────────────────────────────────────────────────────────────
// CarePlan — §6: assigns the PT, sets Patient.primaryTherapistId. Never
// silently overwritten: a reassignment is audited and shows on the
// patient timeline.
// ─────────────────────────────────────────────────────────────────────────

export async function createCarePlanFor(
  user: AbilitySubject,
  input: CarePlanInput & { patientId: string; track: "WELLNESS" | "REHAB"; prescriptionId?: string }
) {
  if (!canAccess(user, "carePlan", "write")) throw new ForbiddenError("Your role cannot create a care plan")

  const patient = await getPatientFor(user, input.patientId)
  if (!patient) throw new ForbiddenError("Cannot create a care plan for a patient outside your scope")

  if (input.track === "REHAB") {
    if (!input.prescriptionId) throw new Error("A REHAB care plan must reference a signed prescription")
    const prescription = await prisma.prescription.findUniqueOrThrow({ where: { id: input.prescriptionId } })
    if (prescription.status !== "SIGNED") {
      throw new Error("Cannot start a care plan from a prescription that hasn't been signed yet")
    }
  }

  const now = new Date()

  const carePlan = await prisma.carePlan.create({
    data: {
      patientId: input.patientId,
      prescriptionId: input.prescriptionId,
      track: input.track,
      totalSessions: input.totalSessions,
      completedSessions: 0,
      startedAt: now,
      targetEndDate: input.targetEndDate ? new Date(input.targetEndDate) : null,
      status: "ACTIVE",
      assignedTherapistId: input.assignedTherapistId,
      createdById: user.id,
    },
  })

  await assignPrimaryTherapist(user, input.patientId, input.assignedTherapistId)

  return carePlan
}

/** §6: "Patient.primaryTherapistId is set at care-plan assignment and is
 * never silently overwritten — reassignment writes an AuditLog entry and
 * is visible on the patient timeline." */
async function assignPrimaryTherapist(user: AbilitySubject, patientId: string, newTherapistId: string) {
  // Patient RLS has no THERAPIST UPDATE policy at all (write:none on
  // patientDemographics), and even the SELECT read below needs a GUC
  // context to resolve (no context = every policy evaluates to NULL).
  // This whole read+write is a DOCTOR/THERAPIST-triggered side effect of
  // an action already gated on the carePlan resource, not a demographic
  // edit, so we re-present as OWNER for this transaction — same reasoning
  // as completeAppointmentFor's lastVisitAt write in Phase 3.
  const current = await runWithRls(user, async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.role', 'OWNER', true)`
    const patient = await tx.patient.findUniqueOrThrow({ where: { id: patientId }, select: { primaryTherapistId: true } })
    if (patient.primaryTherapistId !== newTherapistId) {
      await tx.patient.update({ where: { id: patientId }, data: { primaryTherapistId: newTherapistId } })
    }
    return patient
  })
  if (current.primaryTherapistId === newTherapistId) return

  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      action: current.primaryTherapistId ? "REASSIGN_PRIMARY_THERAPIST" : "ASSIGN_PRIMARY_THERAPIST",
      entityType: "Patient",
      entityId: patientId,
      before: { primaryTherapistId: current.primaryTherapistId },
      after: { primaryTherapistId: newTherapistId },
    },
  })
}

export async function listCarePlansForPatient(user: AbilitySubject, patientId: string) {
  const patient = await getPatientFor(user, patientId)
  if (!patient) throw new ForbiddenError("Cannot view care plans for a patient outside your scope")

  // assignedTherapistId is a plain scalar (not a Prisma relation — see
  // DECISIONS.md's note on createdById-style references), so the
  // therapist's name is resolved with a second, batched lookup.
  const carePlans = await prisma.carePlan.findMany({
    where: { patientId, deletedAt: null },
    orderBy: { startedAt: "desc" },
  })
  const therapists = await prisma.user.findMany({
    where: { id: { in: carePlans.map((c) => c.assignedTherapistId) } },
    select: { id: true, name: true },
  })
  const nameById = new Map(therapists.map((t) => [t.id, t.name]))

  return carePlans.map((c) => ({ ...c, assignedTherapistName: nameById.get(c.assignedTherapistId) ?? "—" }))
}
