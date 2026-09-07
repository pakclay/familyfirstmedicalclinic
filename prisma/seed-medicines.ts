import { createPrismaClient } from "../lib/db/client-factory"
import { loadEnvFiles, requireDatabaseUrl } from "../lib/db/env-files"
import { MEDICINE_CATALOG } from "./medicine-catalog"

/**
 * Adds the starter medicine catalog to branches that don't have it yet.
 *
 * SEPARATE FROM prisma/seed.ts ON PURPOSE, and this is the whole reason the
 * file exists. `db:seed` opens by deleting every audit log, notification,
 * payment, consultation, patient, user, branch and clinic in the database —
 * it rebuilds a demo from scratch, which is right for a laptop and
 * catastrophic for a clinic that is already seeing patients. This script
 * never deletes anything and never updates an existing row, so it is the
 * one that is safe to point at a running deployment.
 *
 * Idempotent by name within a branch: a medicine that is already there is
 * left exactly as it is, prices included. Run it twice and the second run
 * reports every medicine as already present. That also means it will not
 * "fix" a price someone has edited — deliberately, because they edited it.
 *
 * DRY RUN BY DEFAULT, like `db:retention`. Pass `--execute` to write.
 *
 *   npx tsx prisma/seed-medicines.ts                      # report only
 *   npx tsx prisma/seed-medicines.ts --execute            # catalog, zero stock
 *   npx tsx prisma/seed-medicines.ts --execute --with-opening-stock
 *   npx tsx prisma/seed-medicines.ts --execute --branch=cebu-city
 *
 * On stock: by default every medicine is created with `current_stock = 0`
 * and no movement, because a real clinic's quantities come from its own
 * "Receive stock" screen and inventing them would be writing fiction into
 * an inventory ledger that money is reconciled against.
 * `--with-opening-stock` is for demo and staging databases; it books a
 * RECEIPT movement rather than setting the column, so the
 * ledger-equals-cached-total invariant (§6) holds from the first row.
 */

loadEnvFiles()

const EXECUTE = process.argv.includes("--execute")
const WITH_STOCK = process.argv.includes("--with-opening-stock")
const BRANCH_ARG = process.argv.find((a) => a.startsWith("--branch="))?.slice("--branch=".length)

const prisma = createPrismaClient(requireDatabaseUrl())

async function main() {
  const branches = await prisma.branch.findMany({
    where: BRANCH_ARG ? { slug: BRANCH_ARG } : {},
    select: { id: true, name: true, slug: true, clinic: { select: { name: true } } },
    orderBy: [{ clinic: { name: "asc" } }, { name: "asc" }],
  })

  if (branches.length === 0) {
    console.error(
      BRANCH_ARG ? `No branch with slug "${BRANCH_ARG}".` : "No branches in this database — nothing to add a catalog to."
    )
    process.exit(1)
  }

  if (!EXECUTE) {
    console.log("DRY RUN — nothing will be written. Add --execute to apply.\n")
  }

  const summary: { branch: string; added: number; alreadyThere: number; stock: string }[] = []

  for (const branch of branches) {
    const existing = await prisma.medicine.findMany({
      where: { branchId: branch.id },
      select: { name: true },
    })
    // Case- and space-insensitive, so "amoxicillin " never becomes a second
    // row beside "Amoxicillin". Matching the catalog's own spelling is not
    // enough — these rows are editable by hand.
    const have = new Set(existing.map((m) => m.name.trim().toLowerCase()))
    const missing = MEDICINE_CATALOG.filter((m) => !have.has(m.name.trim().toLowerCase()))

    // Only needed when booking opening stock: stock_movements.performed_by
    // is non-nullable, and the ledger must name a real person. Prefer the
    // branch's own admin; any user in the branch will do.
    let performedByUserId: string | null = null
    if (WITH_STOCK && missing.length > 0) {
      const actor =
        (await prisma.user.findFirst({ where: { branchId: branch.id, role: "BRANCH_ADMIN", isActive: true } })) ??
        (await prisma.user.findFirst({ where: { branchId: branch.id, isActive: true } }))
      performedByUserId = actor?.id ?? null
    }

    const stockNote = !WITH_STOCK
      ? "no stock (receive it in the app)"
      : performedByUserId
        ? "opening stock booked"
        : "SKIPPED stock — no active user in this branch to attribute the movement to"

    if (EXECUTE) {
      for (const m of missing) {
        // One transaction per medicine: the row, its opening movement and
        // the cached total are one fact, and a half-written one would break
        // the invariant the inventory tests assert.
        await prisma.$transaction(async (tx) => {
          const created = await tx.medicine.create({
            data: {
              branchId: branch.id,
              name: m.name,
              genericName: m.genericName,
              form: m.form,
              strength: m.strength,
              unit: m.unit,
              currentStock: 0,
              reorderLevel: m.reorderLevel,
              unitCost: m.unitCost,
              sellingPrice: m.sellingPrice,
              // No expiry: that belongs to a delivery, not to the catalog.
              expiryDate: null,
              isActive: true,
            },
          })
          if (WITH_STOCK && performedByUserId && m.openingStock > 0) {
            await tx.stockMovement.create({
              data: {
                branchId: branch.id,
                medicineId: created.id,
                movementType: "RECEIPT",
                quantityChange: m.openingStock,
                balanceAfter: m.openingStock,
                reason: "Opening stock (catalog seed)",
                performedByUserId,
              },
            })
            await tx.medicine.update({ where: { id: created.id }, data: { currentStock: m.openingStock } })
          }
        })
      }
    }

    summary.push({
      branch: `${branch.clinic.name} — ${branch.name}`,
      added: missing.length,
      alreadyThere: MEDICINE_CATALOG.length - missing.length,
      stock: missing.length === 0 ? "—" : stockNote,
    })
  }

  console.table(summary)
  const total = summary.reduce((n, s) => n + s.added, 0)
  console.log(
    EXECUTE
      ? `\n${total} medicine${total === 1 ? "" : "s"} added across ${branches.length} branch${branches.length === 1 ? "" : "es"}.`
      : `\n${total} medicine${total === 1 ? "" : "s"} would be added. Re-run with --execute to apply.`
  )
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error("seed-medicines failed:", err instanceof Error ? err.message : err)
    await prisma.$disconnect()
    process.exit(1)
  })
