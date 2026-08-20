"use client"

import { useState, useTransition } from "react"
import { rollbackImportBatch } from "@/lib/actions/import"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type Batch = { importBatchId: string; count: number; importedAt: string }

export function ImportHistory({ batches: initial }: { batches: Batch[] }) {
  const [batches, setBatches] = useState(initial)
  const [isPending, startTransition] = useTransition()
  const [rollingBack, setRollingBack] = useState<string | null>(null)

  function handleRollback(batchId: string) {
    setRollingBack(batchId)
    startTransition(async () => {
      await rollbackImportBatch(batchId)
      setBatches((prev) => prev.filter((b) => b.importBatchId !== batchId))
      setRollingBack(null)
    })
  }

  if (batches.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Import history</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Imported</TableHead>
              <TableHead>Patients created</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {batches.map((b) => (
              <TableRow key={b.importBatchId}>
                <TableCell className="font-numeric text-muted-foreground">
                  {new Date(b.importedAt).toLocaleString("en-PH")}
                </TableCell>
                <TableCell className="font-numeric">{b.count}</TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isPending && rollingBack === b.importBatchId}
                    onClick={() => handleRollback(b.importBatchId)}
                  >
                    {isPending && rollingBack === b.importBatchId ? "Rolling back…" : "Undo (soft-delete)"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
