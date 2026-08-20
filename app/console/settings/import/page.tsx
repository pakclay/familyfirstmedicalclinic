import { requireRole } from "@/lib/auth/guards"
import { prisma } from "@/lib/db/prisma"
import { listImportBatches } from "@/lib/actions/import"
import { ImportWizard } from "./import-wizard"
import { ImportHistory } from "./import-history"

export default async function ImportPage() {
  await requireRole(["OWNER"])
  const [branches, batches] = await Promise.all([
    prisma.branch.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    listImportBatches(),
  ])

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Import patients</h1>
        <p className="text-sm text-muted-foreground">
          Upload the Excel/CSV file, map its columns, review a dry run, then commit.
        </p>
      </div>
      <ImportWizard branches={branches.map((b) => ({ id: b.id, name: b.name }))} />
      <ImportHistory batches={batches.map((b) => ({ ...b, importedAt: b.importedAt.toISOString() }))} />
    </div>
  )
}
