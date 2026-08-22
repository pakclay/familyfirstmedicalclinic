import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { listNotifications } from "@/lib/queries/notifications"
import type { AbilitySubject } from "@/lib/permissions/ability"
import { Badge } from "@/components/ui/badge"

const STATUS_VARIANT: Record<string, string> = {
  MOCKED: "border-signal text-signal",
  SENT: "border-brand text-brand",
  FAILED: "border-destructive text-destructive",
  QUEUED: "",
}

export default async function NotificationsPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (session.user.role === "HOLDING_ADMIN") {
    return (
      <div>
        <h1 className="text-2xl font-heading font-semibold">Notifications</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A holding admin isn&apos;t scoped to one clinic — notifications are tracked per clinic.
        </p>
      </div>
    )
  }

  const user: AbilitySubject = {
    id: session.user.id,
    role: session.user.role,
    clinicId: session.user.clinicId,
    holdingCompanyId: session.user.holdingCompanyId,
  }
  const notifications = await listNotifications(user)

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-heading font-semibold">Notifications</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Every send attempt — mocked locally by default until a real SMS/Messenger provider is wired up.
      </p>
      <ul className="mt-4 divide-y divide-border rounded-md border border-border">
        {notifications.map((n) => (
          <li key={n.id} className="px-4 py-3 text-sm">
            <div className="flex items-center justify-between">
              <span>
                {n.patientName} · {n.templateKey.replaceAll("_", " ")}
              </span>
              <Badge variant="outline" className={STATUS_VARIANT[n.status]}>
                {n.status}
              </Badge>
            </div>
            <p className="mt-1 text-muted-foreground">{n.renderedMessage}</p>
            {n.error && <p className="mt-1 text-xs text-destructive">{n.error}</p>}
            <p className="mt-1 text-xs text-muted-foreground">
              {n.channel} · {n.createdAt.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}
            </p>
          </li>
        ))}
        {notifications.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">No notifications sent yet.</li>
        )}
      </ul>
    </div>
  )
}
