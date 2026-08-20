"use server"

import { Prisma, type PatientStatus } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { requireSession } from "@/lib/auth/guards"
import { scopeWhere } from "@/lib/permissions/scoped-queries"
import { generatePatientCode } from "@/lib/patients/patient-code"
import { normalizePhMobile } from "@/lib/validation/patient"
import type { IntakeAnswers } from "@/lib/validation/patient"
import { isMinor } from "@/lib/validation/patient"

export type PatientListItem = Awaited<ReturnType<typeof listPatients>>[number]

export async function listPatients(query: { search?: string; status?: PatientStatus }) {
  const user = await requireSession()
  const where = scopeWhere(user, "patientDemographics", "read", {
    branchField: "homeBranchId",
    ownField: "primaryTherapistId",
  })
  if (!where) return []

  const search = query.search?.trim()
  const and: Prisma.PatientWhereInput[] = [where, { deletedAt: null }]
  if (query.status) and.push({ status: query.status })
  if (search) {
    and.push({
      OR: [
        { firstName: { contains: search, mode: "insensitive" } },
        { lastName: { contains: search, mode: "insensitive" } },
        { mobile: { contains: search } },
        { patientCode: { contains: search, mode: "insensitive" } },
      ],
    })
  }

  return prisma.patient.findMany({
    where: { AND: and },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: {
      id: true,
      patientCode: true,
      firstName: true,
      lastName: true,
      mobile: true,
      status: true,
      homeBranch: { select: { name: true } },
      primaryTherapistId: true,
      lastVisitAt: true,
    },
  })
}

export async function getPatient(id: string) {
  const user = await requireSession()
  const where = scopeWhere(user, "patientDemographics", "read", {
    branchField: "homeBranchId",
    ownField: "primaryTherapistId",
  })
  if (!where) return null

  const patient = await prisma.patient.findFirst({
    where: { AND: [{ id }, where, { deletedAt: null }] },
    include: {
      homeBranch: { select: { name: true } },
      consents: { orderBy: { grantedAt: "desc" } },
      intakeSubmissions: { orderBy: { submittedAt: "desc" } },
    },
  })
  if (!patient) return null

  // §11: every read of a patient chart by a non-assigned staff member is audited.
  if (patient.primaryTherapistId !== user.id) {
    await prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: "VIEW_PATIENT_CHART",
        entityType: "Patient",
        entityId: patient.id,
      },
    })
  }

  return patient
}

const CAN_WRITE_PATIENTS: Array<"OWNER" | "BRANCH_MANAGER" | "FRONT_DESK"> = [
  "OWNER",
  "BRANCH_MANAGER",
  "FRONT_DESK",
]

export type CreatePatientInput = IntakeAnswers & { homeBranchId: string }

export async function createPatientFromIntake(input: CreatePatientInput) {
  const user = await requireSession()
  if (!CAN_WRITE_PATIENTS.includes(user.role as (typeof CAN_WRITE_PATIENTS)[number])) {
    throw new Error("Not permitted to create patients")
  }
  if (user.role !== "OWNER" && user.homeBranchId !== input.homeBranchId) {
    throw new Error("Cannot create a patient outside your branch")
  }

  const branch = await prisma.branch.findUniqueOrThrow({ where: { id: input.homeBranchId } })
  const minor = isMinor(input.birthDate)
  if (minor && !input.guardianName) {
    throw new Error("Guardian name is required for patients under 18")
  }

  // Retry on the rare race where two intakes for the same branch generate
  // the same sequential code at once (see patient-code.ts).
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const patientCode = await generatePatientCode(tx, branch.code)
        const now = new Date()

        const patient = await tx.patient.create({
          data: {
            patientCode,
            firstName: input.firstName,
            lastName: input.lastName,
            middleName: input.middleName || null,
            birthDate: new Date(input.birthDate),
            sex: input.sex,
            mobile: normalizePhMobile(input.mobile),
            email: input.email || null,
            address: input.address,
            city: input.city,
            province: input.province,
            occupation: input.occupation || null,
            sportOrActivity: input.sportOrActivity || null,
            referralSource: input.referralSource || null,
            emergencyContactName: input.emergencyContactName,
            emergencyContactPhone: normalizePhMobile(input.emergencyContactPhone),
            homeBranchId: input.homeBranchId,
            preferredChannel: input.preferredChannel,
            status: "INTAKE_PENDING",
            createdById: user.id,
          },
        })

        const consentRows: Array<{ type: "TREATMENT" | "DATA_PRIVACY" | "MARKETING" | "PHOTO"; granted: boolean }> = [
          { type: "TREATMENT", granted: input.consentTreatment },
          { type: "DATA_PRIVACY", granted: input.consentDataPrivacy },
          { type: "MARKETING", granted: input.consentMarketing },
          { type: "PHOTO", granted: input.consentPhoto },
        ]
        await tx.patientConsent.createMany({
          data: consentRows.map((c) => ({
            patientId: patient.id,
            consentType: c.type,
            granted: c.granted,
            grantedAt: now,
            formVersion: "v1",
            guardianName: minor ? input.guardianName : null,
            createdById: user.id,
          })),
        })

        return patient
      })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && attempt < 4) {
        continue
      }
      throw err
    }
  }
  throw new Error("Could not allocate a patient code — please retry")
}
