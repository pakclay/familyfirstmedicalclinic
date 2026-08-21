"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { addDaysToKey } from "@/lib/scheduling/day-range"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { AppointmentCard, type AppointmentView } from "./appointment-card"
import { BookAppointmentDialog } from "./book-appointment-dialog"
import { AppointmentDetailSheet } from "./appointment-detail-sheet"

export type ScheduleViewProps = {
  dateKey: string
  branchId: string
  canPickBranch: boolean
  isOwner: boolean
  canRecordPayments: boolean
  canWriteSoapNotes: boolean
  branches: { id: string; name: string }[]
  therapists: { id: string; name: string }[]
  services: { id: string; name: string; category: string; durationMin: number; requiresPrescription: boolean }[]
  rooms: { id: string; name: string }[]
  appointments: AppointmentView[]
}

export function ScheduleView(props: ScheduleViewProps) {
  const { dateKey, branchId, canPickBranch, isOwner, canRecordPayments, canWriteSoapNotes, branches, therapists, services, rooms, appointments } =
    props
  const router = useRouter()
  const [bookOpen, setBookOpen] = useState(false)
  const [selected, setSelected] = useState<AppointmentView | null>(null)

  function navigate(next: { date?: string; branchId?: string }) {
    const params = new URLSearchParams()
    params.set("date", next.date ?? dateKey)
    params.set("branchId", next.branchId ?? branchId)
    router.push(`/console/schedule?${params.toString()}`)
  }

  const byTherapist = new Map<string, AppointmentView[]>()
  for (const t of therapists) byTherapist.set(t.id, [])
  for (const a of appointments) {
    if (!byTherapist.has(a.therapistId)) byTherapist.set(a.therapistId, [])
    byTherapist.get(a.therapistId)!.push(a)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Schedule</h1>
          <p className="text-sm text-muted-foreground">Day view, by therapist.</p>
        </div>
        <Button onClick={() => setBookOpen(true)}>Book appointment</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => navigate({ date: addDaysToKey(dateKey, -1) })}>
          ← Prev
        </Button>
        <Input
          type="date"
          value={dateKey}
          onChange={(e) => navigate({ date: e.target.value })}
          className="w-40"
        />
        <Button variant="outline" size="sm" onClick={() => navigate({ date: addDaysToKey(dateKey, 1) })}>
          Next →
        </Button>
        {canPickBranch ? (
          <Select value={branchId} onValueChange={(v) => navigate({ branchId: v })}>
            <SelectTrigger className="w-64">
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
        ) : null}
      </div>

      {therapists.length === 0 ? (
        <p className="text-sm text-muted-foreground">No therapists at this branch yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <div className="flex min-w-full gap-3 pb-2">
            {therapists.map((t) => (
              <div key={t.id} className="w-64 shrink-0 rounded-md border border-border bg-card">
                <div className="border-b border-border px-3 py-2">
                  <p className="text-sm font-medium">{t.name}</p>
                  <p className="font-numeric text-xs text-muted-foreground">
                    {byTherapist.get(t.id)?.length ?? 0} today
                  </p>
                </div>
                <div className="flex flex-col gap-2 p-2">
                  {(byTherapist.get(t.id) ?? []).length === 0 ? (
                    <p className="px-1 py-4 text-center text-xs text-muted-foreground">Nothing booked</p>
                  ) : (
                    byTherapist
                      .get(t.id)!
                      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
                      .map((appt) => <AppointmentCard key={appt.id} appointment={appt} onClick={() => setSelected(appt)} />)
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <BookAppointmentDialog
        open={bookOpen}
        onOpenChange={setBookOpen}
        branchId={branchId}
        dateKey={dateKey}
        therapists={therapists}
        services={services}
        rooms={rooms}
        onBooked={() => router.refresh()}
      />

      <AppointmentDetailSheet
        appointment={selected}
        isOwner={isOwner}
        canRecordPayments={canRecordPayments}
        canWriteSoapNotes={canWriteSoapNotes}
        branchId={branchId}
        onOpenChange={(open) => !open && setSelected(null)}
        onChanged={() => {
          setSelected(null)
          router.refresh()
        }}
      />
    </div>
  )
}
