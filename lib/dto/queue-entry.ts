import type { QueueEntry } from "@prisma/client"

export type QueueEntryDTO = {
  id: string
  patientId: string
  doctorId: string | null
  queueNumber: number
  queueDate: Date
  status: QueueEntry["status"]
  priority: QueueEntry["priority"]
  source: QueueEntry["source"]
  reasonForVisit: string | null
  checkedInAt: Date | null
  calledAt: Date | null
  startedAt: Date | null
  completedAt: Date | null
  createdAt: Date
}

export function toQueueEntryDTO(entry: QueueEntry): QueueEntryDTO {
  return {
    id: entry.id,
    patientId: entry.patientId,
    doctorId: entry.doctorId,
    queueNumber: entry.queueNumber,
    queueDate: entry.queueDate,
    status: entry.status,
    priority: entry.priority,
    source: entry.source,
    reasonForVisit: entry.reasonForVisit,
    checkedInAt: entry.checkedInAt,
    calledAt: entry.calledAt,
    startedAt: entry.startedAt,
    completedAt: entry.completedAt,
    createdAt: entry.createdAt,
  }
}
