"use client"

import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import {
  parseImportFile,
  dryRunImport,
  commitImport,
  type DryRunSummary,
  type DryRunRowResult,
  type RowResolution,
  type CommitImportResult,
} from "@/lib/actions/import"
import { TARGET_FIELDS, type ColumnMapping, type DateFormat, type ImportRow } from "@/lib/import/target-fields"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { PatientStatus } from "@prisma/client"

type Step = "upload" | "map" | "review" | "done"

const STATUS_OPTIONS: PatientStatus[] = ["ACTIVE_PROGRAM", "LEAD", "LAPSED", "COMPLETED", "DISCHARGED"]

export function ImportWizard({ branches }: { branches: { id: string; name: string }[] }) {
  const router = useRouter()
  const [step, setStep] = useState<Step>("upload")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<ImportRow[]>([])
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const [dateFormat, setDateFormat] = useState<DateFormat>("MDY")
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "")
  const [defaultStatus, setDefaultStatus] = useState<PatientStatus>("ACTIVE_PROGRAM")

  const [dryRun, setDryRun] = useState<DryRunSummary | null>(null)
  const [resolutions, setResolutions] = useState<Record<number, RowResolution>>({})
  const [commitResult, setCommitResult] = useState<CommitImportResult | null>(null)

  const missingRequired = useMemo(
    () => TARGET_FIELDS.filter((f) => f.required && !mapping[f.field]).map((f) => f.label),
    [mapping]
  )

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setPending(true)
    try {
      const formData = new FormData(e.currentTarget)
      const result = await parseImportFile(formData)
      if (result.rows.length === 0) throw new Error("No rows found in that file.")
      setHeaders(result.headers)
      setRows(result.rows)
      setStep("map")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that file.")
    } finally {
      setPending(false)
    }
  }

  async function handleDryRun() {
    setError(null)
    setPending(true)
    try {
      const result = await dryRunImport(rows, mapping, dateFormat, branchId)
      setDryRun(result)
      const defaults: Record<number, RowResolution> = {}
      for (const r of result.results) {
        if (r.status === "create") defaults[r.rowNumber] = "create"
        if (r.status === "conflict") defaults[r.rowNumber] = "skip"
      }
      setResolutions(defaults)
      setStep("review")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dry run failed.")
    } finally {
      setPending(false)
    }
  }

  async function handleCommit() {
    setError(null)
    setPending(true)
    try {
      const result = await commitImport(rows, mapping, dateFormat, branchId, resolutions, defaultStatus)
      setCommitResult(result)
      setStep("done")
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.")
    } finally {
      setPending(false)
    }
  }

  function reset() {
    setStep("upload")
    setHeaders([])
    setRows([])
    setMapping({})
    setDryRun(null)
    setResolutions({})
    setCommitResult(null)
    setError(null)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {step === "upload" && "1. Upload"}
          {step === "map" && "2. Map columns"}
          {step === "review" && "3. Dry run & resolve conflicts"}
          {step === "done" && "Done"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {step === "upload" && (
          <form onSubmit={handleUpload} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="file">Excel (.xlsx) or CSV file</Label>
              <input
                id="file"
                name="file"
                type="file"
                accept=".xlsx,.csv"
                required
                className="block w-full text-sm file:mr-4 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-sm file:font-medium"
              />
            </div>
            <Button type="submit" disabled={pending}>
              {pending ? "Reading…" : "Upload & preview"}
            </Button>
          </form>
        )}

        {step === "map" && (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Branch these patients belong to</Label>
                <Select value={branchId} onValueChange={setBranchId}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Date format in the file</Label>
                <Select value={dateFormat} onValueChange={(v) => setDateFormat(v as DateFormat)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MDY">MM/DD/YYYY (e.g. 03/04/1990 = Mar 4)</SelectItem>
                    <SelectItem value="DMY">DD/MM/YYYY (e.g. 03/04/1990 = Apr 3)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Default status for new patients</Label>
                <Select value={defaultStatus} onValueChange={(v) => setDefaultStatus(v as PatientStatus)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s.replaceAll("_", " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {TARGET_FIELDS.map((f) => (
                <div key={f.field} className="space-y-1">
                  <Label>
                    {f.label}
                    {f.required ? <span className="text-destructive"> *</span> : null}
                  </Label>
                  <Select
                    value={mapping[f.field] ?? "__none__"}
                    onValueChange={(v) => setMapping((m) => ({ ...m, [f.field]: v === "__none__" ? undefined : v }))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— none —</SelectItem>
                      {headers.map((h) => (
                        <SelectItem key={h} value={h}>
                          {h}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            <div>
              <p className="mb-2 text-sm font-medium">Preview (first 20 of {rows.length} rows)</p>
              <div className="overflow-x-auto rounded-md border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {headers.map((h) => (
                        <TableHead key={h}>{h}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.slice(0, 20).map((row, i) => (
                      <TableRow key={i}>
                        {headers.map((h) => (
                          <TableCell key={h} className="whitespace-nowrap">
                            {row[h]}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            {missingRequired.length > 0 ? (
              <p className="text-sm text-destructive">Still need to map: {missingRequired.join(", ")}</p>
            ) : null}

            <div className="flex gap-2">
              <Button variant="outline" onClick={reset}>
                Start over
              </Button>
              <Button onClick={handleDryRun} disabled={pending || missingRequired.length > 0 || !branchId}>
                {pending ? "Checking…" : "Run dry run"}
              </Button>
            </div>
          </div>
        )}

        {step === "review" && dryRun && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-4 text-sm">
              <span>
                <span className="font-numeric font-semibold">{dryRun.wouldCreate}</span> new
              </span>
              <span>
                <span className="font-numeric font-semibold">{dryRun.wouldConflict}</span> possible duplicates
              </span>
              <span>
                <span className="font-numeric font-semibold">{dryRun.wouldError}</span> errors (won&apos;t import)
              </span>
            </div>

            <div className="max-h-[32rem] overflow-y-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Row</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Mobile</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dryRun.results.map((r) => (
                    <ReviewRow key={r.rowNumber} result={r} resolutions={resolutions} setResolutions={setResolutions} />
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep("map")}>
                Back
              </Button>
              <Button onClick={handleCommit} disabled={pending}>
                {pending ? "Importing…" : "Commit import"}
              </Button>
            </div>
          </div>
        )}

        {step === "done" && commitResult && (
          <div className="space-y-4">
            <Alert>
              <AlertDescription>
                Created <span className="font-numeric">{commitResult.created}</span>, merged{" "}
                <span className="font-numeric">{commitResult.merged}</span>, skipped{" "}
                <span className="font-numeric">{commitResult.skipped}</span>.
              </AlertDescription>
            </Alert>
            <Button onClick={reset}>Import another file</Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ReviewRow({
  result,
  resolutions,
  setResolutions,
}: {
  result: DryRunRowResult
  resolutions: Record<number, RowResolution>
  setResolutions: React.Dispatch<React.SetStateAction<Record<number, RowResolution>>>
}) {
  if (result.status === "error") {
    return (
      <TableRow>
        <TableCell className="font-numeric">{result.rowNumber}</TableCell>
        <TableCell colSpan={2} className="text-sm text-destructive">
          {result.errors.join("; ")}
        </TableCell>
        <TableCell>
          <Badge variant="destructive">Error</Badge>
        </TableCell>
        <TableCell className="text-muted-foreground text-sm">Won&apos;t import</TableCell>
      </TableRow>
    )
  }

  const options: RowResolution[] = result.status === "conflict" ? ["skip", "merge", "create"] : ["create", "skip"]

  return (
    <TableRow>
      <TableCell className="font-numeric">{result.rowNumber}</TableCell>
      <TableCell>
        {result.data.lastName}, {result.data.firstName}
      </TableCell>
      <TableCell className="font-numeric">{result.data.mobile}</TableCell>
      <TableCell>
        {result.status === "conflict" ? (
          <Badge variant="secondary">Matches existing ({result.matchedOn})</Badge>
        ) : (
          <Badge>New</Badge>
        )}
      </TableCell>
      <TableCell>
        <Select
          value={resolutions[result.rowNumber] ?? options[0]}
          onValueChange={(v) => setResolutions((r) => ({ ...r, [result.rowNumber]: v as RowResolution }))}
        >
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o} value={o}>
                {o === "create" ? "Create" : o === "merge" ? "Merge" : "Skip"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
    </TableRow>
  )
}
