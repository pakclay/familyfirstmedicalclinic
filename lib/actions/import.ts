"use server"

import { randomUUID } from "node:crypto"
import ExcelJS from "exceljs"
import Papa from "papaparse"
import { requireRole } from "@/lib/auth/guards"
import { prisma } from "@/lib/db/prisma"
import { generatePatientCode } from "@/lib/patients/patient-code"
import { analyzeRow, type ParsedRowData } from "@/lib/import/analyze"
import type { ColumnMapping, DateFormat, ImportRow } from "@/lib/import/target-fields"
import type { PatientStatus } from "@prisma/client"

const MAX_ROWS = 5000

export async function parseImportFile(formData: FormData): Promise<{ headers: string[]; rows: ImportRow[] }> {
  await requireRole(["OWNER"])

  const file = formData.get("file")
  if (!(file instanceof File)) throw new Error("No file uploaded")

  const buffer = Buffer.from(await file.arrayBuffer())
  const name = file.name.toLowerCase()

  if (name.endsWith(".csv")) {
    const text = buffer.toString("utf-8")
    const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true })
    const headers = parsed.meta.fields ?? []
    const rows = parsed.data.slice(0, MAX_ROWS)
    return { headers, rows }
  }

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer)
  const sheet = workbook.worksheets[0]
  if (!sheet) throw new Error("The workbook has no sheets")

  const headerRow = sheet.getRow(1)
  const headers: string[] = []
  headerRow.eachCell({ includeEmpty: false }, (cell) => {
    headers.push(String(cell.value ?? "").trim())
  })

  const rows: ImportRow[] = []
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    if (rows.length >= MAX_ROWS) return
    const record: ImportRow = {}
    headers.forEach((header, i) => {
      const cell = row.getCell(i + 1)
      record[header] = formatCellValue(cell.value)
    })
    rows.push(record)
  })

  return { headers, rows }
}

function formatCellValue(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return ""
  if (value instanceof Date) {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(
      value.getUTCDate()
    ).padStart(2, "0")}`
  }
  if (typeof value === "object" && "text" in value) return String(value.text)
  if (typeof value === "object" && "result" in value) return String(value.result ?? "")
  return String(value)
}

export type DryRunRowResult =
  | { rowNumber: number; status: "error"; errors: string[] }
  | { rowNumber: number; status: "create"; data: ParsedRowData }
  | { rowNumber: number; status: "conflict"; data: ParsedRowData; matchedPatientId: string; matchedOn: "mobile" | "name+dob" }

export type DryRunSummary = {
  results: DryRunRowResult[]
  wouldCreate: number
  wouldConflict: number
  wouldError: number
}

export async function dryRunImport(
  rows: ImportRow[],
  mapping: ColumnMapping,
  dateFormat: DateFormat,
  branchId: string
): Promise<DryRunSummary> {
  await requireRole(["OWNER"])

  const existing = await prisma.patient.findMany({
    where: { homeBranchId: branchId, deletedAt: null },
    select: { id: true, mobile: true, lastName: true, birthDate: true },
  })
  const byMobile = new Map(existing.map((p) => [p.mobile, p]))
  const byNameDob = new Map(existing.map((p) => [`${p.lastName.toLowerCase()}|${p.birthDate.toISOString().slice(0, 10)}`, p]))

  const results: DryRunRowResult[] = rows.map((row, i) => {
    const analysis = analyzeRow(row, mapping, dateFormat, i + 2) // +2: header row + 1-indexing
    if (!analysis.ok) return { rowNumber: analysis.rowNumber, status: "error", errors: analysis.errors }

    const mobileMatch = byMobile.get(analysis.data.mobile)
    if (mobileMatch) {
      return { rowNumber: analysis.rowNumber, status: "conflict", data: analysis.data, matchedPatientId: mobileMatch.id, matchedOn: "mobile" }
    }
    const nameDobKey = `${analysis.data.lastName.toLowerCase()}|${analysis.data.birthDate}`
    const nameDobMatch = byNameDob.get(nameDobKey)
    if (nameDobMatch) {
      return { rowNumber: analysis.rowNumber, status: "conflict", data: analysis.data, matchedPatientId: nameDobMatch.id, matchedOn: "name+dob" }
    }

    return { rowNumber: analysis.rowNumber, status: "create", data: analysis.data }
  })

  return {
    results,
    wouldCreate: results.filter((r) => r.status === "create").length,
    wouldConflict: results.filter((r) => r.status === "conflict").length,
    wouldError: results.filter((r) => r.status === "error").length,
  }
}

export type RowResolution = "create" | "merge" | "skip"

export type CommitImportResult = {
  importBatchId: string
  created: number
  merged: number
  skipped: number
}

export async function commitImport(
  rows: ImportRow[],
  mapping: ColumnMapping,
  dateFormat: DateFormat,
  branchId: string,
  resolutions: Record<number, RowResolution>,
  defaultStatus: PatientStatus
): Promise<CommitImportResult> {
  const user = await requireRole(["OWNER"])
  const branch = await prisma.branch.findUniqueOrThrow({ where: { id: branchId } })
  const dryRun = await dryRunImport(rows, mapping, dateFormat, branchId)
  const importBatchId = randomUUID()

  let created = 0
  let merged = 0
  let skipped = 0

  await prisma.$transaction(async (tx) => {
    for (const result of dryRun.results) {
      if (result.status === "error") {
        skipped++
        continue
      }

      const resolution = resolutions[result.rowNumber] ?? (result.status === "create" ? "create" : "skip")
      if (resolution === "skip") {
        skipped++
        continue
      }

      if (resolution === "create") {
        const patientCode = await generatePatientCode(tx, branch.code)
        const created1 = await tx.patient.create({
          data: {
            patientCode,
            firstName: result.data.firstName,
            lastName: result.data.lastName,
            middleName: result.data.middleName || null,
            birthDate: new Date(result.data.birthDate),
            sex: result.data.sex,
            mobile: result.data.mobile,
            email: result.data.email || null,
            address: result.data.address,
            city: result.data.city,
            province: result.data.province,
            occupation: result.data.occupation || null,
            sportOrActivity: result.data.sportOrActivity || null,
            referralSource: result.data.referralSource || null,
            emergencyContactName: result.data.emergencyContactName || "Not provided",
            emergencyContactPhone: result.data.emergencyContactPhone || result.data.mobile,
            homeBranchId: branchId,
            status: defaultStatus,
            importBatchId,
            createdById: user.id,
          },
        })
        await tx.auditLog.create({
          data: {
            actorId: user.id,
            action: `IMPORT_CREATE:${importBatchId}`,
            entityType: "Patient",
            entityId: created1.id,
            after: created1 as object,
          },
        })
        created++
        continue
      }

      // merge — only fill in fields the existing record doesn't already have.
      if (result.status === "conflict") {
        const before = await tx.patient.findUniqueOrThrow({ where: { id: result.matchedPatientId } })
        const patch: Record<string, unknown> = {}
        const d = result.data
        if (!before.email && d.email) patch.email = d.email
        if (!before.middleName && d.middleName) patch.middleName = d.middleName
        if (!before.occupation && d.occupation) patch.occupation = d.occupation
        if (!before.sportOrActivity && d.sportOrActivity) patch.sportOrActivity = d.sportOrActivity
        if (!before.referralSource && d.referralSource) patch.referralSource = d.referralSource
        if (d.emergencyContactName && before.emergencyContactName === "Not provided") {
          patch.emergencyContactName = d.emergencyContactName
        }

        if (Object.keys(patch).length > 0) {
          const after = await tx.patient.update({ where: { id: before.id }, data: patch })
          await tx.auditLog.create({
            data: {
              actorId: user.id,
              action: `IMPORT_MERGE:${importBatchId}`,
              entityType: "Patient",
              entityId: before.id,
              before: before as object,
              after: after as object,
            },
          })
        }
        merged++
      }
    }
  })

  return { importBatchId, created, merged, skipped }
}

export async function listImportBatches() {
  await requireRole(["OWNER"])
  const grouped = await prisma.patient.groupBy({
    by: ["importBatchId"],
    where: { importBatchId: { not: null }, deletedAt: null },
    _count: { _all: true },
    _min: { createdAt: true },
  })
  return grouped
    .map((g) => ({ importBatchId: g.importBatchId!, count: g._count._all, importedAt: g._min.createdAt! }))
    .sort((a, b) => b.importedAt.getTime() - a.importedAt.getTime())
}

/** §11: nothing hard-deletes — a bad import is undone by soft-deleting every
 * patient it created. Merges aren't auto-reverted (the AuditLog before/after
 * rows have what changed for a manual fix). */
export async function rollbackImportBatch(importBatchId: string) {
  const user = await requireRole(["OWNER"])
  const result = await prisma.patient.updateMany({
    where: { importBatchId, deletedAt: null },
    data: { deletedAt: new Date() },
  })
  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      action: `IMPORT_ROLLBACK:${importBatchId}`,
      entityType: "Patient",
      entityId: importBatchId,
      after: { softDeletedCount: result.count },
    },
  })
  return result.count
}
