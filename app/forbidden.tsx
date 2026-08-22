import { ShieldAlert } from "lucide-react"

export default function Forbidden() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-priority/10 text-priority">
        <ShieldAlert className="size-5" aria-hidden />
      </span>
      <h1 className="text-2xl font-heading font-semibold">403 — Forbidden</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        You don&apos;t have access to this record. This attempt has been recorded in the audit log.
      </p>
    </main>
  )
}
