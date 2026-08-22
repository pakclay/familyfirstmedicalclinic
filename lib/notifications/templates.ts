/**
 * §7.6: "All templates live in one config file so clinic staff can edit
 * wording without touching code." Every trigger point (§7.6's table) has
 * exactly one entry here — this is the only place message wording lives.
 */

export type TemplateKey = "booking_confirmed" | "almost_your_turn" | "now_serving" | "no_show" | "follow_up_due"

export type TemplatePayloads = {
  booking_confirmed: { patientName: string; clinicName: string; clinicAddress: string; queueNumber: number; statusUrl: string }
  almost_your_turn: { patientName: string; clinicName: string; queueNumber: number }
  now_serving: { patientName: string; clinicName: string; queueNumber: number }
  no_show: { patientName: string; clinicName: string; clinicPhone: string }
  follow_up_due: { patientName: string; clinicName: string; doctorName: string; followUpDate: string }
}

export const TEMPLATES: { [K in TemplateKey]: (p: TemplatePayloads[K]) => string } = {
  booking_confirmed: (p) =>
    `Hi ${p.patientName}! Your booking at ${p.clinicName} is confirmed. Your queue number is ${p.queueNumber}. ` +
    `Check your status anytime: ${p.statusUrl}. Clinic address: ${p.clinicAddress}`,

  almost_your_turn: (p) =>
    `Hi ${p.patientName}, almost your turn at ${p.clinicName} (queue #${p.queueNumber}) — please proceed to the clinic.`,

  // §7.6's literal wording says "please proceed to Room X," but the schema
  // has no room/counter field to fill that in with — genericized to the
  // clinic itself rather than fabricate a room number. Revisit if the
  // owner wants per-doctor rooms tracked.
  now_serving: (p) =>
    `${p.patientName}, you're being called now at ${p.clinicName} — your number ${p.queueNumber} is being served. Please proceed to the clinic.`,

  no_show: (p) => `Hi ${p.patientName}, we missed you at ${p.clinicName} today. Please call ${p.clinicPhone} or visit again to rebook.`,

  follow_up_due: (p) =>
    // No "Dr. " prefix here — `doctorName` already carries the title from
    // how doctor display names are stored (see DECISIONS.md, M4: the same
    // double "Dr. Dr." bug already found and fixed in the UI once).
    `Hi ${p.patientName}, this is a reminder for your follow-up checkup with ${p.doctorName} at ${p.clinicName} on ${p.followUpDate}.`,
}

export function renderTemplate<K extends TemplateKey>(key: K, payload: TemplatePayloads[K]): string {
  return TEMPLATES[key](payload)
}
