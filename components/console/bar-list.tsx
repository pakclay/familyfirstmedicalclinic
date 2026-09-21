export type BarListRow = {
  key: string
  label: string
  sublabel?: string
  /** Sets the bar's length relative to the longest row. */
  value: number
  /** What the reader sees beside the bar — already formatted. */
  display: string
}

/**
 * A ranked horizontal bar chart that is also its own table: name, bar,
 * value on one line each, so a screen reader and a phone at arm's length
 * get the same figures the bar draws. Plain markup on purpose — §8 says
 * "do not build a charting framework", and a handful of branches never
 * needs axes or a tooltip. One hue, because the rows are one series.
 */
export function BarList({ title, rows, emptyLabel = "Nothing yet." }: { title: string; rows: BarListRow[]; emptyLabel?: string }) {
  const max = rows.reduce((m, r) => Math.max(m, r.value), 0)
  return (
    <section>
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ol className="mt-2 space-y-2.5">
          {rows.map((r) => (
            <li key={r.key} className="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm">
              <span className="min-w-0">
                <span className="block truncate">{r.label}</span>
                {r.sublabel && <span className="block truncate text-xs text-muted-foreground">{r.sublabel}</span>}
              </span>
              {/* The number beside it is the accessible reading; the bar only draws it. */}
              <span aria-hidden="true" className="block h-2.5 min-w-0">
                <span className="block h-full rounded-r-[4px] bg-brand" style={{ width: max > 0 ? `${(r.value / max) * 100}%` : 0 }} />
              </span>
              <span className="font-numeric text-muted-foreground">{r.display}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
