import { randomUUID } from "node:crypto"
import { addDays } from "date-fns"
import type { PaymentMethod } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { runWithRls } from "@/lib/db/rls"
import { ForbiddenError } from "@/lib/permissions/errors"
import { canAccess, type AbilitySubject } from "@/lib/permissions/ability"
import { insertPaymentNoReturning } from "@/lib/queries/payments"
import { getPatientFor } from "@/lib/queries/patients"

export async function listActivePackagesFor(user: AbilitySubject, patientId: string) {
  if (!canAccess(user, "packages", "read")) throw new ForbiddenError("Your role cannot view packages")
  // canAccess only checks the coarse resource-level rule (does this role
  // ever get to read packages) — branch/own scoping still has to be
  // checked against this specific patient, or a BRANCH_MANAGER could pull
  // another branch's patient's packages by calling this directly with an
  // arbitrary id. getPatientFor already does that scoping correctly.
  const patient = await getPatientFor(user, patientId)
  if (!patient) throw new ForbiddenError("Cannot view packages for a patient outside your scope")

  return prisma.patientPackage.findMany({
    where: { patientId, status: "ACTIVE", deletedAt: null },
    include: { package: { select: { name: true, sessionCount: true } } },
    orderBy: { purchasedAt: "desc" },
  })
}

export type SellPackageInput = {
  patientId: string
  branchId: string
  packageId: string
  method: PaymentMethod
  referenceNo?: string
}

/**
 * Sells a package: one PatientPackage (the credits) + one Payment (the
 * money), created together so a package can never exist without its
 * payment being on record. §4.1: packages RW branch for FRONT_DESK,
 * payments write branch for FRONT_DESK — both checked, since this touches
 * both resources.
 */
export async function sellPackageFor(user: AbilitySubject, input: SellPackageInput) {
  if (!canAccess(user, "packages", "write")) throw new ForbiddenError("Your role cannot sell packages")
  if (!canAccess(user, "payments", "write")) throw new ForbiddenError("Your role cannot record the payment for a package")
  if (user.role !== "OWNER" && user.homeBranchId !== input.branchId) {
    throw new ForbiddenError("Cannot sell a package for another branch")
  }

  const pkg = await prisma.package.findUniqueOrThrow({ where: { id: input.packageId } })
  if (!pkg.isActive) throw new Error("This package is no longer offered")

  const now = new Date()

  return runWithRls(user, async (tx) => {
    const patientPackage = await tx.patientPackage.create({
      data: {
        patientId: input.patientId,
        packageId: pkg.id,
        purchasedAt: now,
        sessionsTotal: pkg.sessionCount,
        sessionsUsed: 0,
        expiresAt: addDays(now, pkg.validityDays),
        createdById: user.id,
      },
    })

    // Not tx.payment.create() — see the comment on insertPaymentNoReturning
    // in payments.ts: FRONT_DESK can INSERT a payment but has no SELECT
    // policy on Payment, and Prisma's .create() always does an implicit
    // RETURNING, which Postgres RLS blocks unless the SELECT policy also
    // passes.
    await insertPaymentNoReturning(tx, {
      id: randomUUID(),
      patientId: input.patientId,
      branchId: input.branchId,
      amountCentavos: pkg.priceCentavos,
      method: input.method,
      referenceNo: input.referenceNo,
      patientPackageId: patientPackage.id,
      receivedById: user.id,
      receivedAt: now,
    })

    return patientPackage
  })
}
