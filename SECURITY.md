# SECURITY.md

This is a prototype/MVP, not a production deployment. Medical records are
sensitive personal information under the Philippine Data Privacy Act of
2012 (RA 10173) — this document exists so nobody mistakes "it runs" for
"it's ready to hold real patients." Read this before entering any real
patient data.

## What's actually in place

- **Passwords are hashed** with bcrypt (`bcryptjs`, 10 rounds), both at
  seed time and at login. No plaintext credential is ever stored or
  logged — the seed script prints the one shared dev password
  (`FamilyFirst2026!`) to the console, not into a committed file.
- **Every route is gated server-side twice.** `proxy.ts` redirects a
  signed-out request to `/login` and bounces a signed-in role away from a
  section it can't enter (`/staff`, `/doctor`, `/console`); this is a
  coarse first gate, not the real boundary. The actual authorization is
  in the query layer — every function takes an `AbilitySubject` derived
  from the server session (never a client-supplied id) and is scoped by
  `clinicId`. Postgres Row-Level Security is a second, independent
  backstop on top of that (`lib/db/rls.ts`): the app's runtime database
  role (`webinar_app`) is deliberately not a superuser, so RLS policies
  actually apply — a bug in the app-layer scoping check still can't leak
  another clinic's rows, because the database itself won't return them.
- **Clinical and financial access is audit-logged.** Patient reads
  (`patient.read` / `patient.read.denied`), registrations, consultations,
  payments, remittances, expenses, and inventory movements all write an
  `audit_logs` row with who, what, and when. A denied cross-clinic read
  returns a real HTTP 403 (`app/forbidden.tsx`, via Next.js's
  `forbidden()`) and is logged in the same request, not silently dropped.
- **Patient access tokens** (`/q/<token>`) are generated with
  cryptographically random UUIDs, are single-purpose (only resolve a
  queue entry, nothing else), and expire at end of day — checked by
  comparing the entry's `queueDate` to today's date in the clinic's own
  timezone, not by a separate expiry field that could drift out of sync.
- **The public display screen never shows patient names** — only queue
  numbers, matching §10's explicit requirement.
- **Consent is captured, not assumed.** Both the walk-in and public
  booking forms require checking a consent checkbox before submission
  will succeed (enforced server-side via Zod, not just a disabled
  button), and `Patient.consentAt` records the timestamp.
- **Data minimization**: the schema stores what §6 specifies and nothing
  speculative. DTOs (`lib/dto/patient.ts` and siblings) are field
  allowlists, not raw Prisma row pass-throughs — a new column added to a
  table later doesn't silently start appearing in an API response.
- **Secrets stay out of the app config.** `.env.example` documents every
  variable with no real values committed; the runtime DB connection
  (`APP_DATABASE_URL`) and the migration connection (`DATABASE_URL`) are
  deliberately separate credentials with different privilege levels.
- **Outbound notifications default to a mock channel** — `MockChannel`
  logs to the console and the `notifications` table instead of actually
  texting or messaging anyone. Real `SmsChannel`/`MessengerChannel`
  implementations throw loudly if ever selected without being finished,
  rather than silently no-opping and giving a false sense that
  notifications are being delivered.
- **`tsc`, `eslint`, and the test suite run automatically on every push
  and PR** (`.github/workflows/ci.yml`), against a real Postgres service
  container rather than a mock, so the RLS backstop and the superuser/
  `webinar_app` connection split actually get exercised in CI the same
  way they do locally — not stubbed out because a real database is
  inconvenient in a CI environment. This exists precisely because its
  absence let a real bug ship: a defect in the shared clinic-timezone
  date logic (`todayAsQueueDate` and everything built on it — queue
  numbering, report ranges, follow-up due dates, the expenses list) sat
  wrong through five milestones, caught only by chance during a manual
  walkthrough. See the gap below for what CI still doesn't cover.

## What must be hardened before real patient data goes in

- **TLS.** Nothing in this repo terminates TLS — `npm run dev`/`start`
  serve plain HTTP. Production needs a reverse proxy or platform (nginx,
  Caddy, a managed load balancer) terminating HTTPS in front of the app,
  with HTTP disabled or redirected, before any real credential or patient
  record crosses the network.
- **Backups.** There is no backup strategy — a local dev Postgres
  instance with no scheduled dumps, no point-in-time recovery, no tested
  restore procedure. Before real data: automated daily backups, an
  offsite/separate-region copy, and an actual rehearsed restore (not just
  a cron job nobody has verified works).
- **Encryption at rest.** The database has no at-rest encryption
  configured at the application level; this depends entirely on the
  hosting platform's disk/volume encryption (most managed Postgres
  offerings enable it by default, but verify — don't assume). No column
  is separately encrypted, so anyone with raw database access reads
  clinical notes and payment amounts in plain text.
- **Breach procedure.** None exists. RA 10173 requires notifying the
  National Privacy Commission and affected individuals within specific
  timeframes after a personal-data breach. Before going live: a written
  incident-response plan (who's notified, in what order, within what
  window), and a designated Data Protection Officer, per RA 10173's own
  requirement for any organization processing sensitive personal
  information at this scale.
- **Retention policy.** Nothing in this codebase ever deletes old data —
  patients, consultations, and payments accumulate forever. RA 10173's
  proportionality principle expects data to be kept only as long as
  necessary; before real use, decide an actual retention period per
  record type and build the deletion/archival job, not just soft-delete
  flags that hide a row from the UI while leaving it in the database
  indefinitely.
- **Forced password change is not built.** `mustChangePassword` is set to
  `true` on every seeded user and the field exists on `User`, but no
  screen actually enforces it — a staff member can keep using the
  dev-shared password forever. Needed before real use: an actual
  first-login change-password flow, plus a password policy (minimum
  length/complexity) beyond "whatever bcrypt will hash."
- **No rate limiting or brute-force protection on login.** The
  Credentials provider has no attempt throttling, lockout, or CAPTCHA.
  Add rate limiting (per-IP and per-account) before this is reachable
  from the public internet.
- **No session revocation beyond the next request.** The `isActive`
  re-check in the `jwt` callback deactivates a user on their *next*
  request, not mid-session on an already-open tab — there's no server-side
  session store to invalidate immediately. Acceptable for a prototype;
  a real incident (stolen device, terminated employee) needs faster
  revocation than "eventually, on their next click."
- **Branch protection requires the `gate` CI check and a pull request
  before a merge to `master`** — a red run or a direct push can no longer
  land. But CI still doesn't scan for known-vulnerable dependencies on its
  own schedule; `npm audit` currently reports 0 findings (as of the
  `next@16.3.2` upgrade, which also happened to fix the last 3), but that's
  a snapshot, not ongoing coverage — before real data, add `npm audit` (or
  Dependabot/Renovate) on a schedule so a newly-disclosed vulnerability in
  an existing, untouched dependency gets noticed without anyone having to
  go looking for it.
- **No PHI-specific access reviews.** Audit logs are written, but nothing
  reviews them — no alerting on unusual access patterns (e.g. one account
  reading an abnormal number of patient records in a short window), and
  no periodic access review of who still legitimately needs an account.
- **Real notification providers are unvetted.** `SmsChannel`/
  `MessengerChannel` are stubs. Before switching a real provider on:
  confirm the provider's own data-handling terms are compatible with
  RA 10173 (patient phone numbers and queue status are being sent to a
  third party), and don't put patient names or clinical details in the
  message body beyond what §7.6's templates already use.

## Reporting a concern

This is a prototype without a live deployment or a security contact yet.
If you find something here that looks wrong before real patient data is
ever entered, flag it to whoever owns this repo directly rather than
filing a public issue.
