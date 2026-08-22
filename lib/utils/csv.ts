/** Every report gets a CSV export (§8) — one small, shared serializer rather than a bespoke one per report. */
export function toCsv(rows: Record<string, string | number>[]): string {
  if (rows.length === 0) return ""
  const headers = Object.keys(rows[0])
  const escape = (v: string | number) => {
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [headers.join(","), ...rows.map((row) => headers.map((h) => escape(row[h])).join(","))]
  return lines.join("\n")
}
