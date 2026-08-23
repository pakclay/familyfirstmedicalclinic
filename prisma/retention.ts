import { PrismaClient } from "@prisma/client"
import { previewExpiredRecords, purgeExpiredRecords, type RetentionCounts } from "@/lib/retention/purge"

// Connects via DATABASE_URL (the migration/superuser role), same as
// prisma/seed.ts — this operation needs DELETE, which the app's runtime
// APP_DATABASE_URL role deliberately doesn't have. See
// prisma/grant-app-role.sql and lib/retention/purge.ts.
const prisma = new PrismaClient()

const EXECUTE = process.argv.includes("--execute")

function printCounts(counts: RetentionCounts) {
  console.table(counts)
}

async function main() {
  if (!EXECUTE) {
    console.log("Dry run — nothing will be deleted. Pass --execute to actually purge.\n")
    const counts = await previewExpiredRecords(prisma)
    printCounts(counts)
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0)
    if (total > 0) {
      console.log(`\n${total} row(s) would be deleted. Re-run with --execute to actually delete them.`)
    } else {
      console.log("\nNothing is past its retention window.")
    }
    return
  }

  console.log("Purging records past their retention window (see lib/retention/policy.ts)...\n")
  const counts = await purgeExpiredRecords(prisma)
  printCounts(counts)
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0)
  console.log(`\nDeleted ${total} row(s). Logged as a single retention.purge audit_logs entry.`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
