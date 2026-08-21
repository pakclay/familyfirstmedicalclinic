"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import type { StaffQueueEntryDTO } from "@/lib/queries/queue"
import type { DoctorOption } from "@/lib/queries/doctors"
import { compareQueueOrder } from "@/lib/utils/queue-order"
import {
  callNextAction,
  checkInAction,
  assignDoctorAction,
  recallAction,
  noShowAction,
  startConsultationAction,
  moveOrderAction,
} from "@/lib/actions/queue"

// §7.3: poll every 5–10s, not WebSockets — simpler and survives flaky
// mobile connections, per the spec's own DECISION.
const POLL_MS = 7000

export function QueueBoard({ initialEntries, doctors }: { initialEntries: StaffQueueEntryDTO[]; doctors: DoctorOption[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const id = setInterval(() => router.refresh(), POLL_MS)
    return () => clearInterval(id)
  }, [router])

  const entries = initialEntries
  const nowServing = entries
    .filter((e) => e.status === "CALLED" || e.status === "IN_CONSULTATION")
    .sort((a, b) => (b.calledAt?.getTime() ?? 0) - (a.calledAt?.getTime() ?? 0))[0]
  const called = entries.filter((e) => e.status === "CALLED")
  const active = entries.filter((e) => e.status === "CHECKED_IN" || e.status === "WAITING").sort(compareQueueOrder)
  const booked = entries.filter((e) => e.status === "BOOKED")
  const inConsultation = entries.filter((e) => e.status === "IN_CONSULTATION")

  function run(action: () => Promise<unknown>) {
    setError(null)
    startTransition(async () => {
      try {
        await action()
        router.refresh()
      } catch {
        setError("That didn't work — try again.")
      }
    })
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Now serving</p>
          <p className="font-numeric text-6xl font-bold text-brand">{nowServing ? nowServing.queueNumber : "—"}</p>
        </div>
        <Button size="lg" className="h-14 px-8 text-base" disabled={pending} onClick={() => run(callNextAction)}>
          Call Next
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      {called.length > 0 && (
        <Section title="Called">
          {called.map((e) => (
            <Row key={e.id} entry={e}>
              {!e.doctorId && (
                <DoctorSelect doctors={doctors} disabled={pending} onSelect={(doctorId) => run(() => assignDoctorAction(e.id, doctorId))} />
              )}
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => recallAction(e.id))}>
                Recall
              </Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => noShowAction(e.id))}>
                No-show
              </Button>
              <Button
                size="sm"
                disabled={pending || !e.doctorId}
                title={e.doctorId ? undefined : "Assign a doctor first"}
                onClick={() => run(() => startConsultationAction(e.id))}
              >
                Start consultation
              </Button>
            </Row>
          ))}
        </Section>
      )}

      {inConsultation.length > 0 && (
        <Section title="In consultation">
          {inConsultation.map((e) => (
            <Row key={e.id} entry={e} />
          ))}
        </Section>
      )}

      <Section title={`Waiting (${active.length})`}>
        {active.map((e, i) => (
          <Row key={e.id} entry={e}>
            <div className="flex items-center gap-1">
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={pending || i === 0}
                aria-label="Move up"
                onClick={() => run(() => moveOrderAction(e.id, "up"))}
              >
                ↑
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={pending || i === active.length - 1}
                aria-label="Move down"
                onClick={() => run(() => moveOrderAction(e.id, "down"))}
              >
                ↓
              </Button>
            </div>
            <DoctorSelect
              doctors={doctors}
              selectedId={e.doctorId}
              disabled={pending}
              onSelect={(doctorId) => run(() => assignDoctorAction(e.id, doctorId))}
            />
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => noShowAction(e.id))}>
              No-show
            </Button>
          </Row>
        ))}
        {active.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nobody waiting.</p>}
      </Section>

      {booked.length > 0 && (
        <Section title={`Upcoming bookings (${booked.length})`}>
          {booked.map((e) => (
            <Row key={e.id} entry={e}>
              <Button size="sm" disabled={pending} onClick={() => run(() => checkInAction(e.id))}>
                Check in
              </Button>
            </Row>
          ))}
        </Section>
      )}
    </div>
  )
}

function DoctorSelect({
  doctors,
  selectedId,
  disabled,
  onSelect,
}: {
  doctors: DoctorOption[]
  selectedId?: string | null
  disabled?: boolean
  onSelect: (doctorId: string) => void
}) {
  return (
    <select
      className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
      disabled={disabled}
      defaultValue={selectedId ?? ""}
      onChange={(ev) => ev.target.value && onSelect(ev.target.value)}
    >
      <option value="">Assign doctor…</option>
      {doctors.map((d) => (
        <option key={d.id} value={d.id}>
          {d.name}
        </option>
      ))}
    </select>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-6">
      <h2 className="mb-2 text-sm font-medium text-muted-foreground">{title}</h2>
      <ul className="divide-y divide-border rounded-md border border-border">{children}</ul>
    </div>
  )
}

function Row({ entry, children }: { entry: StaffQueueEntryDTO; children?: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="font-numeric w-8 text-lg font-semibold">{entry.queueNumber}</span>
        <div>
          <p className="text-sm">
            {entry.patientName}
            {entry.priority === "PRIORITY" && (
              <Badge variant="outline" className="ml-2 border-priority text-priority">
                Priority
              </Badge>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {entry.patientAge}y · {entry.reasonForVisit}
            {entry.doctorName && ` · ${entry.doctorName}`}
          </p>
        </div>
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </li>
  )
}
