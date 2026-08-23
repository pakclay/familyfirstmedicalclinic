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
  walkthrough.
- **Branch protection requires the `gate` CI check and a pull request
  before a merge to `master`** — a red run or a direct push can no
  longer land.
- **Dependency vulnerabilities are scanned continuously, not just at
  audit time.** Dependabot alerts, security updates, grouped security
  updates, and version updates (`.github/dependabot.yml`) are all
  enabled — a newly-disclosed CVE in an existing, untouched dependency
  opens a PR automatically instead of waiting for someone to run
  `npm audit` and go looking. Those PRs go through the same `gate` check
  and branch-protection rule as any other change before they can merge.
- **A first-login (and voluntary) password change screen exists and is
  enforced.** `/change-password` — reachable from every authenticated
  shell's header — is where `proxy.ts` redirects any request whose
  session has `mustChangePassword: true`, before the role/section gate
  even runs; there's no route that bypasses it. The new password must be
  10+ characters with at least one letter and one number
  (`lib/validation/password.ts`), can't equal the current password, and
  changing it clears `mustChangePassword` and signs the user out (the
  simplest way to guarantee the session actually reflects the change,
  given `proxy.ts`'s Prisma-free JWT only gets re-signed on a fresh
  sign-in — see the `Dependabot enabled` entry's sibling in
  `DECISIONS.md` for why that split exists at all).
- **Per-account login lockout.** After 5 consecutive failed password
  attempts, an account locks for 15 minutes (`lib/queries/users.ts`) —
  checked *before* the password compare, so a locked account can't be
  brute-forced by attempts made while already locked, and the login
  form shows the same generic "Incorrect email or password" either way
  rather than confirming a lockout is in effect. Per-IP throttling is
  still not built — see below.
- **Admin-managed user accounts, scoped by role.** A Holding Admin can
  create, edit, deactivate/reactivate, force a password reset on, or
  unlock any account in any clinic; a Clinic Admin can do the same but
  only for front desk/doctor accounts in their own clinic — enforced in
  `lib/queries/users.ts`, not just hidden in the UI (a Clinic Admin's own
  account and any other clinic's accounts return "not found," not a
  filtered list, so there's nothing to enumerate). Admin-created accounts
  get a random one-time temporary password shown once on screen, never
  logged or emailed, and inherit the same forced-first-login-change flow
  as any other account. `users`, `doctors`, and `clinics` have no
  Postgres RLS policy at all (only the tables listed in
  `enable_rls_backstop`'s migration do) — this feature relies entirely on
  the application-layer scoping above, so a bug here isn't caught by a
  database backstop the way patient/queue/payment queries are.
- **The audit trail is readable, and scoped to one holding company.**
  `/console/audit-log` lets a holding admin browse and filter every
  recorded action — by date, action, entity type, clinic, acting user, or
  entity id — over the append-only `audit_logs` table. It is read-only:
  no edit, no delete, no mutation of any kind. Access is holding-admin
  only at both the page and the query layer, and a forbidden read throws
  rather than returning an empty list, which matters especially here
  because an empty list is also what a misconfigured RLS session
  produces — a broken gate and an empty table must not look alike.
  Postgres RLS is *not* the tenant boundary on this table: its
  holding-admin branch is a blanket role check that says nothing about
  which holding company the reader belongs to, so the query narrows to
  the actor's own holding company itself, and the client-supplied filters
  are AND-ed with that scope so none of them can widen it.
- **A real data-retention job exists** (`lib/retention/`) — not just
  soft-delete flags that hide a row from the UI while it sits in the
  database indefinitely. `npm run db:retention` deletes patients,
  consultations (and their dispensed-medicine rows), payments, queue
  entries, and notifications once they're past their configured
  retention window, respecting the schema's FK constraints and the
  cascade this implies: a queue entry only becomes eligible once its
  consultation is also expired, and a patient only becomes eligible once
  nothing still-retained references it at all. Runs through the same
  superuser connection as `prisma/seed.ts`, since the app's runtime role
  has no `DELETE` grant at all — this can't run from inside the app
  itself. Defaults to a dry-run report; needs `-- --execute` to actually
  delete. Not yet running on a schedule anywhere — see below.

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
- **The retention job exists but isn't scheduled anywhere.**
  `npm run db:retention` (dry-run by default, `-- --execute` to actually
  delete — `lib/retention/`) purges patients/consultations/payments/
  queue entries/notifications past their configured retention window
  (`lib/retention/policy.ts`), with the deletion order and cascade logic
  actually enforced rather than left to soft-delete flags nobody purges.
  What's still missing is running it on an actual schedule (cron / a
  hosting platform's scheduled jobs / a GitHub Actions cron once there's
  a real `DATABASE_URL` to point it at) — deferred alongside TLS and
  backups above until a hosting platform is chosen, since there's nothing
  real to schedule it against yet. The retention *periods* themselves
  (see `lib/retention/policy.ts`) are defensible defaults, not a legal
  opinion — confirm them against actual PH medical-records and BIR
  requirements before this runs against real patient data.
- **No per-IP rate limiting on login.** Per-account lockout exists (see
  above), which stops a brute-force pass against any one known account —
  but nothing throttles login attempts by source IP, so a single account
  could still be probed slowly (below the lockout threshold) or many
  accounts probed a few times each without ever tripping it. This is
  deliberately left to the deployment layer (reverse proxy / platform
  rate limiting) rather than approximated with an in-process, per-instance
  counter that wouldn't survive a restart or work once there's more than
  one instance — same reasoning as TLS above. Decide alongside TLS when a
  real host is chosen; add a CAPTCHA too if that host doesn't already
  cover it.
- **No session revocation beyond the next request.** The `isActive`
  re-check in the `jwt` callback deactivates a user on their *next*
  request, not mid-session on an already-open tab — there's no server-side
  session store to invalidate immediately. Acceptable for a prototype;
  a real incident (stolen device, terminated employee) needs faster
  revocation than "eventually, on their next click."
- **No PHI-specific access *alerting*.** Audit logs are now readable — a
  holding admin can browse and filter them at `/console/audit-log` (see
  above) — but nothing watches them. There is no alerting on unusual
  access patterns (e.g. one account reading an abnormal number of patient
  records in a short window), and no periodic access review of who still
  legitimately needs an account. Reading the trail is now possible;
  noticing something in it still depends on a human going to look.
- **Nothing audits the audit log.** Viewing `/console/audit-log` is
  deliberately not itself recorded (the reasoning is in
  `lib/queries/audit-log.ts`), so there is no record of who inspected the
  trail or what they filtered for. If that becomes a compliance
  requirement, it needs a separate access-log sink — writing it back into
  `audit_logs` would fill the table with records of people reading the
  table.
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
