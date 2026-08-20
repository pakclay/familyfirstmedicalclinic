import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { prisma } from "@/lib/db/prisma"
import { runWithRls } from "@/lib/db/rls"
import { superuserPrisma } from "@/lib/test/superuser-prisma"
import { listPaymentsFor } from "../payments"
import { createPatientRecordFor } from "../patients"
import { ForbiddenError } from "@/lib/permissions/errors"
import type { AbilitySubject, Role } from "@/lib/permissions/ability"

// This is the Phase 2 "done when": a THERAPIST account cannot reach any
// money figure, proven by test — at both the application layer
// (listPaymentsFor throws) and the RLS backstop (a raw, unfiltered query
// still returns zero rows for a role RLS doesn't grant SELECT to at all).

const owner: AbilitySubject = { role: "OWNER", id: "test-owner-payments", homeBranchId: null }

let branch: { id: string }
let patientId: string
let paymentId: string

function subject(role: Role, id: string, homeBranchId: string | null): AbilitySubject {
  return { role, id, homeBranchId }
}

beforeAll(async () => {
  branch = await prisma.branch.upsert({
    where: { code: "TEST-P2-PAY" },
    update: {},
    create: {
      code: "TEST-P2-PAY",
      name: "Phase 2 Payments Test Branch",
      address: "",
      city: "",
      province: "",
      phone: "",
      openingHours: {},
    },
  })

  const patient = await createPatientRecordFor(owner, {
    firstName: "Money",
    lastName: "Test",
    birthDate: "1990-01-01",
    sex: "FEMALE",
    mobile: "09171112222",
    address: "1 Test St.",
    city: "San Fernando",
    province: "Pampanga",
    emergencyContactName: "Emergency Contact",
    emergencyContactPhone: "09179998888",
    consentTreatment: true,
    consentDataPrivacy: true,
    consentMarketing: false,
    consentPhoto: false,
    homeBranchId: branch.id,
  })
  patientId = patient.id

  const payment = await runWithRls(owner, (tx) =>
    tx.payment.create({
      data: {
        patientId,
        branchId: branch.id,
        amountCentavos: 150000, // ₱1,500.00
        method: "CASH",
        receivedById: "test-front-desk",
        receivedAt: new Date(),
      },
    })
  )
  paymentId = payment.id
})

afterAll(async () => {
  // DELETE has no RLS policy at all (see superuser-prisma.ts) — teardown
  // needs the privileged connection, not runWithRls.
  await superuserPrisma.payment.deleteMany({ where: { branchId: branch.id } })
  await superuserPrisma.patientConsent.deleteMany({ where: { patientId } })
  await superuserPrisma.patient.deleteMany({ where: { homeBranchId: branch.id } })
  await superuserPrisma.branch.delete({ where: { id: branch.id } })
  await superuserPrisma.$disconnect()
  await prisma.$disconnect()
})

describe("no role but OWNER/BRANCH_MANAGER can read a money figure", () => {
  it.each<Role>(["THERAPIST", "DOCTOR", "FRONT_DESK", "MARKETING"])(
    "%s throws ForbiddenError, never an empty list, when reading payments",
    async (role) => {
      await expect(listPaymentsFor(subject(role, `test-${role}`, branch.id), branch.id)).rejects.toThrow(
        ForbiddenError
      )
    }
  )

  it("BRANCH_MANAGER in the same branch can read the payment, amount included", async () => {
    const rows = await listPaymentsFor(subject("BRANCH_MANAGER", "mgr", branch.id), branch.id)
    expect(rows.some((r) => r.id === paymentId && r.amountCentavos === 150000)).toBe(true)
  })

  it("BRANCH_MANAGER in a different branch sees nothing for this branch", async () => {
    const rows = await listPaymentsFor(subject("BRANCH_MANAGER", "mgr2", "some-other-branch-id"), branch.id)
    expect(rows).toHaveLength(0)
  })
})

describe("RLS backstop: even a raw query with no WHERE can't leak Payment rows", () => {
  it.each<Role>(["THERAPIST", "DOCTOR", "FRONT_DESK", "MARKETING"])(
    "%s gets zero rows from an unfiltered Payment query",
    async (role) => {
      const rows = await runWithRls(subject(role, `rls-${role}`, branch.id), (tx) => tx.payment.findMany({}))
      expect(rows).toHaveLength(0)
    }
  )
})
