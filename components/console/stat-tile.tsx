/**
 * One headline number: a label, the value, and optionally a hint beneath it
 * (a breakdown or a comparison against a named period). A row of these is
 * how the dashboard and reports lead — a handful of figures reads faster
 * than a chart with a handful of bars. The value is mono like every other
 * number in the app (see `.font-numeric` in app/globals.css).
 */
export function StatTile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border p-3">
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p className="font-numeric mt-0.5 text-lg font-semibold leading-tight">{value}</p>
      {hint && <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
