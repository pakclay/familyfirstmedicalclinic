import type { Prisma, PrismaClient } from "@prisma/client"

type Tx = PrismaClient | Prisma.TransactionClient

/**
 * SLPH-{BRANCH}-{00001}, sequential per branch. Call inside the same
 * transaction that creates the Patient row so the count-then-insert isn't
 * racy under concurrent front-desk intake.
 */
export async function generatePatientCode(tx: Tx, branchCode: string): Promise<string> {
  const count = await tx.patient.count({
    where: { patientCode: { startsWith: `SLPH-${branchCode}-` } },
  })
  const seq = String(count + 1).padStart(5, "0")
  return `SLPH-${branchCode}-${seq}`
}
