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
 * Stale per-IP rate-limit counters (lib/rate-limit/). Re-exported rather
 * than redefined so the window it cleans up and the windows it has to
 * outlast stay next to each other in lib/rate-limit/policy.ts — this file
 * is where the purge job looks, that file is where the number is argued
 * about.
 *
 * Unlike everything else here this is not a compliance retention period at
 * all: `rate_limits` rows are operational state with no legal or clinical
 * value, and the app role cannot delete them itself (no DELETE grant — see
 * prisma/grant-app-role.sql), so pruning them belongs to this job rather
 * than to a second cleanup path of its own.
 */
export { RATE_LIMIT_RETENTION_DAYS } from "@/lib/rate-limit/policy"

/**
 * How old a patient's own row must be — once zero queue entries,
 * consultations, payments, or notifications reference it anymore — before
 * the bare identity/demographic record itself is purged. Same window as
 * consultations; there's no separate reason to hold the identity record
 * longer or shorter than the clinical history it used to be attached to.
 */
export const PATIENT_RETENTION_DAYS = 2555
