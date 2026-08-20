"use client"

import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { listPatients } from "@/lib/actions/patients"
import { getAvailableSlots, createAppointment } from "@/lib/actions/scheduling"
import { listActivePackages } from "@/lib/actions/packages"
import type { PatientListItem } from "@/lib/actions/patients"
import type { AppointmentSource } from "@prisma/client"

type Service = { id: string; name: string; category: string; durationMin: number; requiresPrescription: boolean }
type Slot = { start: string; end: string }
type ActivePackage = { id: string; package: { name: string }; sessionsUsed: number; sessionsTotal: number }

export function BookAppointmentDialog({
  open,
  onOpenChange,
  branchId,
  dateKey,
  therapists,
  services,
  rooms,
  onBooked,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  branchId: string
  dateKey: string
  therapists: { id: string; name: string }[]
  services: Service[]
  rooms: { id: string; name: string }[]
  onBooked: () => void
}) {
  const [search, setSearch] = useState("")
  const [results, setResults] = useState<PatientListItem[]>([])
  const [patient, setPatient] = useState<PatientListItem | null>(null)
  const [serviceId, setServiceId] = useState("")
  const [therapistId, setTherapistId] = useState("")
  const [date, setDate] = useState(dateKey)
  const [slots, setSlots] = useState<Slot[]>([])
  const [slot, setSlot] = useState<Slot | null>(null)
  const [roomId, setRoomId] = useState("")
  const [source, setSource] = useState<AppointmentSource>("WALK_IN")
  const [packages, setPackages] = useState<ActivePackage[]>([])
  const [patientPackageId, setPatientPackageId] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  function reset() {
    setSearch("")
    setResults([])
    setPatient(null)
    setServiceId("")
    setTherapistId("")
    setDate(dateKey)
    setSlots([])
    setSlot(null)
    setRoomId("")
    setSource("WALK_IN")
    setPackages([])
    setPatientPackageId("")
    setError(null)
  }

  useEffect(() => {
    // Clearing every field when the dialog closes (so it opens fresh next
    // time) is tied to the dialog's open/close transition, not derivable
    // from render — the standard React-Compiler-preferred alternatives
    // don't apply to this case. `reset` is intentionally omitted from the
    // deps array — it's stable in behavior (always resets to the same
    // defaults) and re-adding it would fire this effect on every render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!open) reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!therapistId || !serviceId || !date) return
    // Clear the previously-picked slot before fetching the new list, so a
    // stale selection from the last therapist/service/date can't linger
    // while the new one loads.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSlot(null)
    getAvailableSlots({ therapistId, branchId, serviceId, date: new Date(`${date}T12:00:00`) })
      .then((s) => setSlots(s.map((x) => ({ start: x.start, end: x.end }))))
      .catch(() => setSlots([]))
  }, [therapistId, serviceId, date, branchId])

  useEffect(() => {
    // Deselecting a patient clears `packages` immediately in the "Change"
    // button's own handler below, so this effect only ever runs with a
    // real patient to fetch for.
    if (!patient) return
    listActivePackages(patient.id)
      .then((p) =>
        setPackages(
          p.map((row) => ({
            id: row.id,
            package: { name: row.package.name },
            sessionsUsed: row.sessionsUsed,
            sessionsTotal: row.sessionsTotal,
          }))
        )
      )
      .catch(() => setPackages([]))
  }, [patient])

  async function handleSearch() {
    if (!search.trim()) return
    const rows = await listPatients({ search })
    setResults(rows)
  }

  async function handleBook() {
    setError(null)
    if (!patient || !serviceId || !therapistId || !slot) {
      setError("Fill in patient, service, therapist, and a time slot.")
      return
    }
    setPending(true)
    try {
      await createAppointment({
        patientId: patient.id,
        branchId,
        therapistId,
        serviceId,
        roomId: roomId || undefined,
        startsAt: new Date(slot.start),
        source,
        patientPackageId: patientPackageId || undefined,
      })
      onBooked()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not book this appointment.")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Book appointment</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-2">
            <Label>Patient</Label>
            {patient ? (
              <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                <span>
                  {patient.lastName}, {patient.firstName} · <span className="font-numeric">{patient.patientCode}</span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setPatient(null)
                    setPackages([])
                    setPatientPackageId("")
                  }}
                >
                  Change
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input
                    placeholder="Search name, mobile, or patient code"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  />
                  <Button type="button" variant="outline" onClick={handleSearch}>
                    Search
                  </Button>
                </div>
                {results.length > 0 ? (
                  <div className="max-h-40 overflow-y-auto rounded-md border border-border">
                    {results.map((r) => (
                      <button
                        key={r.id}
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-secondary"
                        onClick={() => {
                          setPatient(r)
                          setResults([])
                        }}
                      >
                        {r.lastName}, {r.firstName} · <span className="font-numeric">{r.mobile}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Service</Label>
              <Select value={serviceId} onValueChange={setServiceId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a service" />
                </SelectTrigger>
                <SelectContent>
                  {services.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} ({s.durationMin}m)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Therapist</Label>
              <Select value={therapistId} onValueChange={setTherapistId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a therapist" />
                </SelectTrigger>
                <SelectContent>
                  {therapists.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>

          {therapistId && serviceId ? (
            <div className="space-y-2">
              <Label>Available times</Label>
              {slots.length === 0 ? (
                <p className="text-sm text-muted-foreground">No open slots that day — try another date or therapist.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {slots.map((s) => (
                    <button
                      key={s.start}
                      onClick={() => setSlot(s)}
                      className={`rounded-md border px-2 py-1 text-xs font-numeric ${
                        slot?.start === s.start ? "border-primary bg-primary text-primary-foreground" : "border-border"
                      }`}
                    >
                      {new Date(s.start).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" })}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Room (optional)</Label>
              <Select value={roomId || "__none__"} onValueChange={(v) => setRoomId(v === "__none__" ? "" : v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No room assigned</SelectItem>
                  {rooms.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Source</Label>
              <Select value={source} onValueChange={(v) => setSource(v as AppointmentSource)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="WALK_IN">Walk-in</SelectItem>
                  <SelectItem value="PHONE">Phone</SelectItem>
                  <SelectItem value="FB_MESSENGER">Facebook Messenger</SelectItem>
                  <SelectItem value="REBOOK">Rebook</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {packages.length > 0 ? (
            <div className="space-y-2">
              <Label>Use a package credit (optional)</Label>
              <Select value={patientPackageId || "__none__"} onValueChange={(v) => setPatientPackageId(v === "__none__" ? "" : v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Pay per visit</SelectItem>
                  {packages.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.package.name} ({p.sessionsUsed}/{p.sessionsTotal} used)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleBook} disabled={pending}>
            {pending ? "Booking…" : "Book"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
