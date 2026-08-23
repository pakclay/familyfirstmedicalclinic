/**
 * How long each record type is kept before `prisma/retention.ts` purges it.
 * These are defensible *defaults*, not a legal opinion — RA 10173's
 * proportionality principle sets the general "no longer than necessary"
 * bar, but the exact numbers for medical records (consultations, and the
 * patient identity record once nothing clinical/financial references it
 * anymore) and bookkeeping records (payments) should be confirmed against
 * actual PH medical-records and BIR retention requirements before this
 * runs against real patient data — these are commonly-cited minimums, not
 * a substitute for that confirmation. Change these constants, not the
 * purge logic, if the real numbers differ.
 */

/** Operational send-log rows — low compliance value, short window. */
export const NOTIFICATION_RETENTION_DAYS = 90

/**
 * 7 years — a commonly-cited minimum for adult medical records. Applies to
 * both consultations and queue entries (the same visit, two rows), since a
 * queue entry with no consultation attached is lower-value than the visit
 * record itself but there's no reason to keep it around any longer.
 */
export const CONSULTATION_RETENTION_DAYS = 2555

/** 10 years — a commonly-cited ceiling for PH bookkeeping/BIR records. */
export const PAYMENT_RETENTION_DAYS = 3650

/**
 * How old a patient's own row must be — once zero queue entries,
 * consultations, payments, or notifications reference it anymore — before
 * the bare identity/demographic record itself is purged. Same window as
 * consultations; there's no separate reason to hold the identity record
 * longer or shorter than the clinical history it used to be attached to.
 */
export const PATIENT_RETENTION_DAYS = 2555
