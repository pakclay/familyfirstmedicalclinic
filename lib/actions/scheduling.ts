"use server"

import { requireSession } from "@/lib/auth/guards"
import {
  listAppointmentsFor,
  getBookingContextFor,
  getAvailableSlotsFor,
  getServicePriceForCheckoutFor,
  createAppointmentFor,
  checkInAppointmentFor,
  completeAppointmentFor,
  markNoShowFor,
  cancelAppointmentFor,
  type CreateAppointmentInput,
} from "@/lib/queries/scheduling"

export async function listAppointments(query: { branchId: string; therapistId?: string; dayStart: Date; dayEnd: Date }) {
  const user = await requireSession()
  return listAppointmentsFor(user, query)
}

export async function getBookingContext(branchId: string) {
  const user = await requireSession()
  return getBookingContextFor(user, branchId)
}

export async function getServicePriceForCheckout(serviceId: string) {
  const user = await requireSession()
  return getServicePriceForCheckoutFor(user, serviceId)
}

export async function getAvailableSlots(params: { therapistId: string; branchId: string; serviceId: string; date: Date }) {
  const user = await requireSession()
  const slots = await getAvailableSlotsFor(user, params)
  return slots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() }))
}

export async function createAppointment(input: CreateAppointmentInput) {
  const user = await requireSession()
  return createAppointmentFor(user, input)
}

export async function checkInAppointment(appointmentId: string) {
  const user = await requireSession()
  return checkInAppointmentFor(user, appointmentId)
}

export async function completeAppointment(appointmentId: string, overrideReason?: string) {
  const user = await requireSession()
  return completeAppointmentFor(user, appointmentId, { overrideReason })
}

export async function markNoShow(appointmentId: string, noShowFeeCentavos?: number) {
  const user = await requireSession()
  return markNoShowFor(user, appointmentId, noShowFeeCentavos)
}

export async function cancelAppointment(appointmentId: string, reason: string) {
  const user = await requireSession()
  return cancelAppointmentFor(user, appointmentId, reason)
}
