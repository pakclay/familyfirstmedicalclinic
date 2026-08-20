"use client"

import { cn } from "@/lib/utils"

export type AppointmentView = {
  id: string
  patientId: string
  serviceId: string
  startsAt: string
  endsAt: string
  status: string
  therapistId: string
  patientName: string
  patientCode: string
  serviceName: string
  serviceCategory: string
  roomName: string | null
  hasPackage: boolean
}

const STATUS_LABELS: Record<string, string> = {
  BOOKED: "Booked",
  CONFIRMED: "Confirmed",
  CHECKED_IN: "Checked in",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  NO_SHOW: "No-show",
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" })
}

export function AppointmentCard({ appointment, onClick }: { appointment: AppointmentView; onClick: () => void }) {
  const isWellness = appointment.serviceCategory === "WELLNESS"
  const dimmed = appointment.status === "CANCELLED" || appointment.status === "NO_SHOW"

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full rounded-md border-l-4 bg-secondary/40 px-2 py-1.5 text-left text-xs transition-colors hover:bg-secondary",
        isWellness ? "border-l-wellness" : "border-l-rehab",
        dimmed && "opacity-50"
      )}
    >
      <p className="font-numeric font-medium">
        {formatTime(appointment.startsAt)}–{formatTime(appointment.endsAt)}
      </p>
      <p className="truncate font-medium">{appointment.patientName}</p>
      <p className="truncate text-muted-foreground">{appointment.serviceName}</p>
      <div className="mt-1 flex items-center justify-between">
        <span className="text-muted-foreground">{appointment.roomName ?? "—"}</span>
        <span className="rounded bg-background px-1.5 py-0.5">{STATUS_LABELS[appointment.status] ?? appointment.status}</span>
      </div>
    </button>
  )
}
