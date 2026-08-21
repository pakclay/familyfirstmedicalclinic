import { requireRole } from "@/lib/auth/guards"
import { prisma } from "@/lib/db/prisma"
import { listAppointments, getBookingContext } from "@/lib/actions/scheduling"
import { manilaDayRange, todayManilaKey } from "@/lib/scheduling/day-range"
import { canAccess } from "@/lib/permissions/ability"
import { ScheduleView } from "@/components/schedule/schedule-view"

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; branchId?: string; therapistId?: string }>
}) {
  const user = await requireRole(["OWNER", "BRANCH_MANAGER", "DOCTOR", "THERAPIST", "FRONT_DESK"])
  const params = await searchParams
  const dateKey = params.date ?? todayManilaKey()

  const branches = await prisma.branch.findMany({ where: { isActive: true }, orderBy: { name: "asc" } })
  const branchId = params.branchId ?? user.homeBranchId ?? branches[0]?.id ?? ""

  const { dayStart, dayEnd } = manilaDayRange(dateKey)
  const [appointments, bookingContext] = await Promise.all([
    listAppointments({ branchId, therapistId: params.therapistId, dayStart, dayEnd }),
    getBookingContext(branchId).catch(() => ({ therapists: [], services: [], rooms: [], patientPackages: [] })),
  ])

  return (
    <ScheduleView
      dateKey={dateKey}
      branchId={branchId}
      canPickBranch={user.role === "OWNER"}
      isOwner={user.role === "OWNER"}
      canRecordPayments={canAccess(user, "payments", "write")}
      canWriteSoapNotes={canAccess(user, "soapNotes", "write")}
      branches={branches.map((b) => ({ id: b.id, name: b.name }))}
      therapists={bookingContext.therapists.map((t) => ({ id: t.id, name: t.name }))}
      services={bookingContext.services}
      rooms={bookingContext.rooms.map((r) => ({ id: r.id, name: r.name }))}
      appointments={appointments.map((a) => ({
        id: a.id,
        patientId: a.patientId,
        serviceId: a.serviceId,
        startsAt: a.startsAt.toISOString(),
        endsAt: a.endsAt.toISOString(),
        status: a.status,
        therapistId: a.therapistId,
        patientName: `${a.patient.lastName}, ${a.patient.firstName}`,
        patientCode: a.patient.patientCode,
        serviceName: a.service.name,
        serviceCategory: a.service.category,
        roomName: a.room?.name ?? null,
        hasPackage: !!a.patientPackageId,
      }))}
    />
  )
}
