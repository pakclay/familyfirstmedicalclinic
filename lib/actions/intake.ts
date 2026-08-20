"use server"

import { prisma } from "@/lib/db/prisma"
import { requireSession } from "@/lib/auth/guards"
import { intakeAnswersSchema, type IntakeAnswers } from "@/lib/validation/patient"
import { createPatientFromIntake } from "@/lib/actions/patients"

export async function getActiveBranchByCode(code: string) {
  return prisma.branch.findFirst({ where: { code, isActive: true } })
}

export type SubmitIntakeState = { error?: string; success?: boolean }

/**
 * Public, unauthenticated: a client filling out the intake form from a
 * branch's kiosk/QR link. Creates an unlinked IntakeSubmission — front desk
 * turns it into a Patient record from the console (§6: intake happens
 * before a Patient necessarily exists).
 */
export async function submitPublicIntake(
  branchCode: string,
  raw: unknown,
  submittedVia: "PUBLIC_LINK" | "KIOSK" = "PUBLIC_LINK"
): Promise<SubmitIntakeState> {
  const branch = await getActiveBranchByCode(branchCode)
  if (!branch) return { error: "This intake link is no longer active." }

  const parsed = intakeAnswersSchema.safeParse(raw)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form and try again." }
  }
  if (!parsed.data.consentDataPrivacy) {
    return { error: "Data privacy consent is required to proceed." }
  }

  await prisma.intakeSubmission.create({
    data: {
      branchId: branch.id,
      formVersion: "v1",
      answers: parsed.data,
      submittedAt: new Date(),
      submittedVia,
    },
  })

  return { success: true }
}

export async function listIntakeQueue() {
  const user = await requireSession()
  if (!["OWNER", "BRANCH_MANAGER", "FRONT_DESK"].includes(user.role)) return []

  const where =
    user.role === "OWNER"
      ? { processedAt: null }
      : { processedAt: null, branchId: user.homeBranchId ?? "__none__" }

  return prisma.intakeSubmission.findMany({
    where,
    orderBy: { submittedAt: "asc" },
    include: { branch: { select: { name: true, code: true } } },
  })
}

/** Turns a pending IntakeSubmission into a real Patient record and marks it processed. */
export async function processIntakeSubmission(submissionId: string) {
  const user = await requireSession()
  if (!["OWNER", "BRANCH_MANAGER", "FRONT_DESK"].includes(user.role)) {
    throw new Error("Not permitted to process intake submissions")
  }

  const submission = await prisma.intakeSubmission.findUniqueOrThrow({ where: { id: submissionId } })
  if (submission.processedAt) throw new Error("Already processed")
  if (user.role !== "OWNER" && submission.branchId !== user.homeBranchId) {
    throw new Error("Cannot process an intake submission from another branch")
  }

  const answers = submission.answers as unknown as IntakeAnswers

  const patient = await createPatientFromIntake({ ...answers, homeBranchId: submission.branchId })

  await prisma.intakeSubmission.update({
    where: { id: submission.id },
    data: { patientId: patient.id, processedAt: new Date(), processedById: user.id },
  })

  return patient
}
