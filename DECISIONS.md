# DECISIONS.md

Running log of assumptions made where the spec was silent or where the
environment forced a deviation. Dated, so the owner can correct any of
these. Newest first.

This repo previously held a different product (Stretch Lab PH, a stretch/
rehab therapy console). That build's own decisions log is preserved in git
history (`git log -- DECISIONS.md`) but doesn't apply to anything below —
this is a fresh log for Family First Medical Clinic.

## 2026-08-22 — M4: consultation, medicine, payment

The doctor's consultation screen (§7.4): patient identity/age/priority/
notes, collapsible prior-visit history, vitals/findings/diagnosis/
treatment-plan/follow-up-date form, a searchable live-stock medicine
picker with "X left → Y after" preview, and payment capture defaulting to
an itemized consultation-fee-plus-medicines total. Saving is one
transaction: Consultation row, per-medicine stock deduction (or not, for
prescribed-only/free-text rows), Payment row, and the queue entry marked
`COMPLETED` — all or nothing. "My collections today" (§9 doctor screen)
and the patient profile's now-enriched visit history are the two places
M4's accept line is actually checked.

Verified live end-to-end as Dr. Quezon City 1: checked in and called Maria
Santos (from the M2/M3 seed data), assigned a doctor, opened the
consultation screen, searched "Paracet" in the medicine picker (found the
seeded catalog item, showed "200 left"), set quantity 4 and watched the
preview read "200 left → 196 after" — the exact format §7.4 specifies —
and the payment amount auto-filled to ₱512.00 (₱500 consultation fee +
4×₱3.00). Submitting completed the consultation, redirected to an
empty "My queue" (entry no longer active), showed ₱512.00 attributed to
the doctor on "My collections today," and the patient's profile
immediately showed the diagnosis and dispensed medicine. Confirmed
directly against Postgres that `current_stock` (196) matches the new
`stock_movements` row's `balance_after`. 33/33 tests pass
(`lib/queries/__tests__/consultations.test.ts`, 6 tests, plus the
existing 27).

- **A medicine row's stock effect is governed by the toggle, not by
  whether it happens to match a catalog item.** §6's "`medicine_id` is
  nullable so a doctor can record a medicine dispensed elsewhere (advised,
  not dispensed)" reads as *the reason* the field is nullable, not a rule
  that only free-text rows may be prescribed-only. Modeled it as: a row
  picked from the catalog can still be toggled "prescribed only" (stock
  untouched, `medicineId` saved as `null` on the `MedicineDispensed` row
  even though a catalog match existed, since the record represents "not
  from our stock"); free text that doesn't match anything is *always*
  prescribed-only, since there's no stock to deduct from. Documented
  inline in `lib/validation/consultation.ts` and enforced there via a
  schema refinement (`dispensedFromStock` requires a `medicineId`), not
  just left to client-side UI discipline.
- **Insufficient stock blocks the whole save with no override yet** — the
  override checkbox + audit-logged reason is explicitly M4b's own accept
  line (§12), but "leaves stock untouched on failure" is basic
  transactional correctness M4 shouldn't ship without, so it's built now:
  every dispensed-from-stock row is checked against a *fresh* read of
  `current_stock` before anything is written, and a shortfall throws
  `InsufficientStockError` before the transaction does anything else —
  Prisma's `$transaction` rolls back the whole thing, so a rejected save
  really does leave stock, the consultation, and the queue entry exactly
  as they were. Test coverage matches M4b's own future acceptance
  wording almost verbatim, on the theory that a check this central is
  worth nailing now rather than only when the override UI arrives.
- **Payment amount is auto-computed (consultation fee + Σ dispensed
  `sellingPrice` × quantity) but stays an editable field**, not a locked
  total — matches the itemized-billing decision from the SPEC.md §13
  Q&A (payment total = consultation fee + medicines, `sellingPrice`
  actively drives the bill) while leaving room for real-world discounts,
  partial payments, or a doctor overriding a wrong catalog price.
- **Found a real timezone bug in the query layer before it shipped, not
  by clicking through the UI:** `listMyCollectionsToday`'s first draft
  filtered `Payment.receivedAt` (a real timestamp) using
  `todayAsQueueDate()` as if it were an instant boundary. That function
  deliberately returns a UTC-midnight *stand-in for a calendar-date
  label* — correct for a `@db.Date` column, where only the Y-M-D matters,
  but wrong as a real instant: Manila midnight is UTC 16:00 the
  *previous* day, 8 hours off from UTC midnight of the same Y-M-D digits.
  Using it directly would've silently excluded roughly the first 8 hours
  of every Manila business day from "today's collections." Added
  `todayInstantRange()` (`lib/queries/queue.ts`), which uses
  `date-fns-tz`'s `fromZonedTime` to re-read that same UTC-constructed
  Y-M-D as *wall-clock time in the clinic's zone* and get the correct
  absolute instant — a different function for a different problem, not a
  fix to the original one, since `todayAsQueueDate` is still exactly
  right for every `@db.Date` use (queue numbering, booking windows).
- **A doctor can only open/save a consultation for a queue entry currently
  assigned to them** (`entry.doctorId === doctor.id`, checked in both
  `getConsultationScreenData` and `saveConsultation`), matching §4's role
  scope ("Doctor: ... own queue") — not just relying on the doctor queue
  *list* already being filtered; a doctor guessing another doctor's
  queue-entry URL gets a `ForbiddenError` → redirect, the same defense-in-
  depth posture as every other role check in this build.
- **"Schedules a follow-up reminder" (§7.4's last sentence) isn't built
  yet** — the `followUpDate` field saves correctly on the Consultation
  row, but no `Notification` row is created for it. Notifications
  (channel interface, `MockChannel`, templates) don't exist until M5;
  wiring a follow-up trigger to a system that isn't there yet would mean
  either stubbing it or building M5 early. Same deferral this build
  already made for §7.1's "send the same link by SMS" in M3.
- **Fixed a pre-existing display bug found while verifying this milestone
  live, not introduced by it:** the patient profile and doctor header both
  prepended "Dr. " to a name that already had it baked in from seed data
  (`"Dr. Quezon City 1"`), rendering "Dr. Dr. Quezon City 1." Fixed the
  two display sites rather than the seed data, since that took effect
  immediately against the demo data already on screen instead of requiring
  a reseed; worth reconsidering whether `User.name` should ever store a
  title at all once real doctor names replace the placeholders.

## 2026-08-21 — M3: queue

Unified queue (booked + walk-in share one numbering line), priority
ordering, staff queue board (Call Next, Recall, Mark No-Show, Assign
Doctor, Check In, Start Consultation, up/down manual reorder), doctor
queue, public display, patient status page, and public booking
(`/book/{clinic_slug}`) — grouped with the other public screens per §9
even though §12's one-line M3 summary doesn't name it explicitly (see
below). Verified end-to-end live in the browser: booked a patient online
for today (queue #3), confirmed her status page said "booking confirmed,"
checked her in from the staff board (now shows "checked in and waiting"),
called next (priority-and-time ordering picked the right patient), watched
the public display and her own status page both reflect the new "now
serving" number, assigned a doctor, started the consultation, and
confirmed that doctor's own queue showed only that one patient. 27/27
tests pass (`lib/queries/__tests__/queue.test.ts` covers ordering,
transitions, clinic scoping, and the public-facing flows).

- **`/book/{clinic_slug}` is in scope for M3** even though §12's M3 line
  only names "staff board, doctor queue, public display, patient status
  page." §9 explicitly groups `/book/{clinic_slug}` and "booking
  confirmation" under the same "Public" heading as `/q/{access_token}` and
  `/display/{clinic_slug}` (both undisputedly M3), and M3's own accept
  line requires "booking and walk-in entries interleave correctly" — which
  needs a real way to produce a booked (not walk-in) entry. Building it now
  rather than inventing a test-only seeding path kept the accept test
  honest.
- **§6's `booked → checked_in → waiting → called → in_consultation →
  completed` isn't fully linear in practice, and the spec doesn't say how
  `checked_in` and `waiting` differ.** Read it as: `CHECKED_IN` = arrived,
  no doctor yet; `WAITING` = arrived *and* assigned a doctor. Assigning a
  doctor is what moves a `CHECKED_IN` entry to `WAITING`; `WAITING` isn't a
  separate manual step. Both statuses are equally eligible for Call Next
  (`ACTIVE_STATUSES`) — a doctor doesn't have to be assigned before someone
  can be called, since front desk may legitimately call the next number
  before deciding who sees them.
- **A doctor must be assignable to an entry that's already been `CALLED`,
  not just while it's `CHECKED_IN`/`WAITING`.** Caught this by actually
  clicking through the flow in the browser, not by reasoning about it in
  advance: the first version only showed the "Assign doctor" dropdown on
  waiting-section rows, so a patient called before a doctor was picked had
  no way to ever get one — `Start Consultation` was permanently disabled
  for them with no path forward. Fixed by allowing `assignDoctor` on a
  `CALLED` entry too (added a regression test for exactly this — assigning
  a doctor to a `CALLED` entry keeps it `CALLED`, doesn't revert it to
  `WAITING`), and added the same dropdown to the Called section.
- **Manual reorder (§7.3's up/down control) swaps the two entries'
  `checkedInAt` values instead of using a separate position column.**
  There's no `sortOrder` field in §6's schema, and adding one this deep
  into a milestone felt like more machinery than the requirement needed —
  moving a normal entry ahead of the rest of the normal tier (never past
  the priority tier) is exactly what a `checkedInAt` swap produces, since
  ordering is already `(priority tier, checkedInAt)`. Every reorder still
  writes an audit log row per the spec's explicit requirement.
- **Queue number allocation and "Call Next" both serialize via the same
  transaction-scoped Postgres advisory lock pattern** (keyed
  `clinicId+day` for numbering, `clinicId+day+":call"` for calling) — two
  front-desk staff clicking Call Next at the same instant must not call
  the same patient twice, for the same reason two simultaneous bookings
  can't get the same number (§7.1). No retry logic needed; the second
  transaction just waits.
- **Public booking's Patient auto-match (phone + last name + birthdate,
  §7.1) reuses the same format-invariant phone comparison as the staff
  side's duplicate search** (M2) rather than a DB-level equality check, for
  the identical reason: a caller's phone formatting won't line up
  character-for-character with what's stored.
- **The patient status page's "estimated wait" is `patientsAhead × 15
  minutes`** — a flat, documented placeholder (`AVERAGE_MINUTES_PER_PATIENT`
  in `lib/queries/public-queue.ts`), not a real average. §7.3 asks for an
  estimate but nothing in the spec supplies a real number yet; M6's
  reporting (average consultation duration) is the natural place to derive
  a real one later.
- **A queue-entry access token "expires at end of day" (§10) by checking
  whether its `queueDate` is still today**, not by storing a separate
  expiry timestamp — `queueDate` already *is* the day the token is valid
  for, so a second field would just be able to disagree with it. A
  next-day booking's token simply isn't live yet rather than being treated
  as already expired, which also seemed like the more correct read of "the
  token for tomorrow's booking" than an error.
- **Looking up a queue entry by access token needs full cross-clinic
  visibility** (`runWithFullVisibility` in `lib/db/rls.ts`) since there's
  no clinic to scope the RLS session by until *after* the row is found —
  documented as intentionally different from the M1 cross-clinic-403
  pattern: token possession is itself the authorization here, not an
  access violation to detect and log.
- **Full-bleed pages (`/display`, `/login`, `/q/{token}`, `app/forbidden.tsx`)
  use `min-h-screen` instead of `min-h-full`.** Found by literally looking
  at the rendered display screen: `min-h-full` needs every ancestor up to
  `<body>` to resolve a *definite* height for the percentage chain to work,
  and `body`'s own `min-h-full` (a min-height, not a height) doesn't
  reliably give descendants one — the display screen rendered as a
  dark box sized to its content with a large gray gap below it, not a
  full-bleed screen. `min-h-screen` is self-contained (relative to the
  viewport directly) and doesn't depend on that chain.

## 2026-08-21 — M2: patients

Walk-in registration (§7.2), duplicate-avoiding phone search, patient
search, and patient profile with visit history. Verified end-to-end live in
the browser as Quezon City front desk: searching an already-seeded
patient's number ("09170001111") found her despite the stored value being
formatted differently ("+63 917 000 1111"), checked her in at queue #1;
registering a genuinely new patient ("Rosa Garcia") got queue #2 in the
same clinic/day; both then showed up correctly in patient search and in
their own profile's visit history. `lib/queries/__tests__/registration.test.ts`
(7 tests) covers the same ground plus clinic-scoping on the two new
mutations and the minor/guardian validation path.

- **§7.2's registration flow inherently includes a queue check-in, not just
  a Patient row** — "registers a walk-in" only makes sense end-to-end if
  the walk-in actually gets a queue number, and §7.2 itself says so
  ("Creates a queue entry with source = walk_in, status checked_in").
  Built the minimum queue-entry machinery needed for that (`nextQueueNumber`,
  `QueueEntry` creation) now, ahead of M3's actual queue *board* (Call Next,
  Recall, Assign Doctor, priority reordering, public display, patient status
  page) — same "infrastructure ahead of the phase that surfaces it" approach
  used for Payment in the prior project's Phase 2. `/staff/queue` is still
  M3's stub; M2 only needed queue entries to exist, not to be managed yet.
- **Queue number allocation uses a Postgres transaction-scoped advisory
  lock** (`pg_advisory_xact_lock(hashtext(clinicId || day))`), not a plain
  `max + 1` read-then-write. Under the default READ COMMITTED isolation,
  two concurrent transactions can both read the same max before either
  commits and then both try to insert the same number — the
  `@@unique([clinicId, queueDate, queueNumber])` constraint would catch the
  collision, but only after the fact, as a failure to handle. The advisory
  lock serializes allocation for that clinic+day key instead, so the second
  transaction just waits for the first to commit — no retry logic needed,
  and it self-releases at commit/rollback (`_xact` variant). Matches §7.1's
  literal "generate it inside a transaction so two simultaneous bookings
  can't collide."
- **"Today" for queue-numbering must use the clinic's own timezone, not the
  server's** — a naive `new Date()` UTC calendar-date read would be a full
  day behind Manila's actual date for the 16:00–23:59 UTC window every day
  (Manila is UTC+8). `lib/queries/queue.ts`'s `todayAsQueueDate(timezone)`
  uses `date-fns-tz`'s `toZonedTime` plus **UTC** getters on the shifted
  instant — the exact fix pattern this repo's own history already recorded
  once (prior project's `availability.ts` bug, `toZonedTime(...).getX()`
  with non-UTC getters silently depending on the host machine's own
  timezone). Takes the clinic's `timezone` column explicitly rather than
  hardcoding `Asia/Manila`, even though every seeded clinic currently uses
  it.
- **Phone matching can't be done with a DB-level `contains` on normalized
  digits** — found this the hard way via a failing test, not by reasoning
  it through up front. A stored number like "+63 917 555 0001" has a space
  inside almost any fixed-width digit window, so a `contains` filter built
  from normalized (punctuation-stripped) digits routinely misses rows whose
  *raw* text just happens to have a space or dash in that exact span.
  `searchPatientsByPhone` now fetches the clinic's own patients (§13: an
  MVP roster is dozens to a few hundred, a real query at this scale, not a
  performance problem hiding as a design choice) and normalizes/compares in
  JS instead.
- **No silent auto-match on walk-in registration** — §7.2's "phone-number
  search first to avoid duplicates" is a staff-driven UI step
  (`searchPatientsByPhone` → front desk picks an existing match or
  confirms "none of these"), deliberately different from §7.1's public
  booking flow, which *does* auto-match by phone + last name + birthdate
  with no human in the loop. That auto-match logic is out of scope until
  M3 wires up online booking; conflating the two now would mean a walk-in
  could silently attach to the wrong record with no staff member ever
  seeing a decision point.
- **`registerWalkIn`/`checkInExistingPatient` take `unknown` input and
  parse with the same Zod schema the UI's server action already validated**
  — deliberate double-validation, not redundant duplication: the action's
  own `safeParse` exists purely to turn a bad submission into a friendly
  inline error instead of an unhandled exception; the query function
  re-validates independently so it's safe to call from anywhere (tests
  included — `registration.test.ts` calls it directly with raw
  string-typed fixture data) without trusting the caller already did it.
- **Patient profile's "visit history" is queue-entry history, not
  consultation history** — §6/§7.4 model the actual consultation record
  (chief complaint, diagnosis, medicines) as a separate table that doesn't
  exist until M4. For M2, "prior visits" means the queue entries themselves
  (date, source, status, priority) — the acceptance line ("surfaces their
  prior visits") is satisfied by that; clinical detail per visit lands with
  M4's consultation screen.
- **Moved patient search/profile from `/console/patients` to
  `/staff/patients`, deleting the M1 console-only version** — §9 lists
  "patient search" and "patient profile with history" under *Staff*
  screens, not Clinic Admin's own console, and middleware already allows
  FRONT_DESK/CLINIC_ADMIN/HOLDING_ADMIN on `/staff/*`. Building it once
  under `/staff` and pointing the console sidebar's "Patients" link there
  avoided a second, drifting implementation of the same list/detail logic
  for clinic admins.
- **Guardian fields render unconditionally on the registration form** (not
  shown/hidden based on the entered birthdate) with helper text explaining
  they're only required for a minor — client-side conditional reveal was
  possible but not load-bearing for correctness, since the server-side Zod
  `superRefine` is the actual enforcement point regardless of what the form
  shows. Revisit for polish if the always-visible fields prove confusing
  in real use.

## 2026-08-21 — Pivot + Section 13 decisions

Before any schema/code, per SPEC.md §0's own instruction to restate the plan
and confirm §13's open questions:

- **Stack (§13.1)**: kept the prior project's stack as-is — Next.js 15 App
  Router/TS, Prisma 6/PostgreSQL, Auth.js (JWT sessions, Credentials
  provider), Tailwind + shadcn/ui. Matches §11's default exactly, and saved
  real setup time (Postgres + a non-superuser `webinar_app` RLS role already
  existed locally from the prior build).
- **Queue model (§13.2)**: number-based queue, not time slots — the spec's
  own default, confirmed.
- **Medicine billing (§13.3)**: itemized separately. Payment total =
  consultation fee + Σ(dispensed medicine `sellingPrice` × quantity);
  `sellingPrice` actively drives the bill, not just inventory valuation.
  Enforced at the M4/M4b payment-capture layer, not yet built.
- **Cash handling point (§13.4)**: left flexible by design, not a hard
  choice — `payments.collectedByUserId` records whoever actually took the
  cash (doctor or front desk) at the time of payment, and the shift-end
  remittance flow (§7.7) reconciles it regardless of who held it. Confirmed
  the schema needs no different shape for either behavior.
- **Branding (§13.5)**: no real clinic name/Facebook page/logo supplied yet —
  using "Family First Medical Clinic" and placeholder clinic
  names/addresses/Facebook URLs throughout (seed data, `app/layout.tsx`
  metadata, `app/globals.css` palette). Swap when the owner provides real
  assets.

**Existing Stretch Lab PH work**: committed as-is (Phase 4 WIP included) on
`master` before removing it, so it's fully recoverable in git history. Then
cleared `app/`, `components/*` (except `components/ui` — generic shadcn
primitives), most of `lib/*`, and `prisma/schema.prisma` + its migrations.
Kept genuinely generic infra as-is: `lib/db/prisma.ts` (RLS-role connection
split), `lib/permissions/errors.ts` (`ForbiddenError`), `lib/test/*`
(superuser test connection + env loader), `lib/utils.ts` (shadcn's `cn()`),
`components.json`, all root tooling config. Rewrote `lib/utils/age.ts`'s
age calculation from a 365.25-day average to a calendar-correct comparison
(UTC getters throughout, matching the timezone-safety lesson the prior
project's own log already recorded) while keeping the file itself.

New local Postgres database `familyfirst_dev`, reusing the existing
non-superuser `webinar_app` role from the prior project (granted access to
the new database rather than creating a second app role) — see the M1
section below for the grant sequence, which needed redoing after
`prisma migrate reset` recreated the `public` schema and silently dropped
the role's schema-level `USAGE` grant.

## 2026-08-21 — M1: schema, auth, clinic scoping

Full schema per §6 (15 tables, all enums), initial migration, a second
migration enabling Postgres RLS as a clinic-scoping backstop, Auth.js
credentials/JWT auth, role-based route gating in middleware, and the
`getPatientById`/`listPatients` query-layer pair that M1's accept line
names directly. Verified end-to-end in the browser: login → role-based
landing page for all three testable roles (clinic admin → `/console/
dashboard`, front desk → `/staff/queue`, and role gating gets a front-desk
user redirected away from `/console/dashboard`), same-clinic patient read,
and the cross-clinic 403 with its audit log row — both the literal §12
acceptance scenario and the underlying RLS backstop are covered by
`lib/queries/__tests__/patients.test.ts` (6/6 passing) as well as the live
click-through.

- **Column naming**: every model field got an explicit `@map("snake_case")`
  (and `@@map` for table names, as before). §6 lists every field in
  snake_case; Prisma's default is to use the schema's own field names
  verbatim as column names, so skipping `@map` would have left the actual
  database with camelCase columns while every example in the spec assumes
  `clinic_id`, `queue_number`, etc. Caught this by hand-testing the RLS
  migration's raw SQL against the first (unmapped) migration attempt, which
  failed with "column clinic_id does not exist" — fixed by rewriting the
  schema with mappings and resetting the (still-empty, dev-only) database
  from scratch rather than trying to migrate the naming in place.
- **`prisma migrate reset` requires explicit per-invocation user consent** —
  the Prisma CLI itself detects it's being run by an AI agent and refuses to
  execute, printing instructions to ask the user and pass their literal
  consent text via `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION`. Asked and
  got explicit "yes" before running it (twice — once for the column-mapping
  fix, and its own schema-recreation silently drops the `webinar_app` role's
  schema-level grants, which had to be redone after each reset). Both resets
  were against the fresh, real-data-free local `familyfirst_dev` database
  created earlier in this same session.
- **RLS scope is broader here than the prior project's** — §5's hard rule
  ("every query that touches patient, queue, or money data") is wider than
  the prior spec's named four tables, so the `enable_rls_backstop` migration
  enables RLS on eleven tables: `patients`, `queue_entries`,
  `consultations`, `medicines`, `stock_movements`, `medicines_dispensed`,
  `payments`, `remittances`, `expenses`, `notifications`, `audit_logs`.
  `users`/`doctors`/`clinics`/`holding_companies` are left unprotected by
  RLS for now — staff-directory access control is an app-layer permission
  concern (who can manage doctors/staff), not named in §5's clinic-scoping
  hard rule specifically. Revisit if a future phase needs it.
- **Distinguishing "doesn't exist" from "exists in another clinic" needs a
  second, deliberately widened read** — under RLS, a `Clinic A` user's query
  for a `Clinic B` patient returns zero rows indistinguishably from a
  genuinely missing id, because the database itself hides the row before
  the app layer ever sees it. To give M1's literal 403 (not just a generic
  404) and log *which* clinic the attempt targeted, `getPatientById`
  performs one extra existence-only lookup with `app.role` temporarily
  widened to `HOLDING_ADMIN` for that single read — the same targeted,
  transaction-scoped RLS re-presentation pattern the prior project used for
  a completion write, reused here for a read. Documented inline in
  `lib/queries/patients.ts`.
- **A thrown error inside `prisma.$transaction` rolls back every write made
  in that transaction — audit log included.** First version of
  `getPatientById` wrote the "denied" audit row and then threw
  `ForbiddenError` inside the same `runWithRls` transaction; the throw
  correctly propagated but silently rolled back the audit insert too, so
  the exact scenario M1's accept line requires ("the attempt appears in the
  audit log") failed a test that otherwise looked like it passed (the
  `rejects.toBeInstanceOf(ForbiddenError)` assertion passed; the audit-log
  assertion didn't). Fixed by having the read transaction return a result
  variant (`found` / `not_found` / `denied`) instead of throwing internally,
  writing the applicable audit row in a **second**, separate transaction
  after the first one commits, and only then throwing.
- **`forbidden()` is a real Next.js 15.5 API, gated behind
  `experimental.authInterrupts`** — used instead of the prior project's
  `ForbiddenError`-with-no-real-status-code workaround (which that project's
  own log noted was "the closest equivalent available," since Server Actions
  don't carry HTTP status codes the way REST does). This Next.js version
  ships `next/navigation`'s `forbidden()`/`unauthorized()` plus
  `app/forbidden.tsx`/`app/unauthorized.tsx` boundary files, which render a
  **genuine HTTP 403/401** — confirmed live (`GET /console/patients/[id]
  403` in the dev server log, not just 200-with-forbidden-looking-text).
  Enabled via `next.config.ts`'s `experimental.authInterrupts: true`; per
  AGENTS.md's warning that this Next.js version has training-data-breaking
  changes, checked `node_modules/next/dist/client/components/forbidden.d.ts`
  directly rather than assuming the old typed-error pattern was still the
  only option.
- **Auth.js + Prisma breaks in `middleware.ts` specifically** — Next.js
  middleware always runs on the Edge runtime, and Prisma Client can't run
  there without Accelerate or Driver Adapters. The `jwt` callback's
  `isActive` re-check (needed so a deactivated account is locked out on its
  very next navigation, not just at next login — mirroring the prior
  project's own documented reasoning) calls `prisma.user.findUnique`, which
  broke every request once wired into a single shared NextAuth config used
  by both middleware and the rest of the app. Fixed with Auth.js's standard
  split: `auth.config.ts` (edge-safe — providers empty, only a Prisma-free
  `session` callback that copies already-encoded JWT claims onto
  `session.user`) used by `middleware.ts` directly via `NextAuth(authConfig)`,
  and the full `auth.ts` (real Credentials provider + the Prisma-touching
  `jwt` callback) used everywhere else, which runs in the Node.js runtime.
- **M1 seed scope**: 1 holding company, 3 clinics (placeholder Quezon City/
  Makati/Cebu locations — no real branch list yet, §13.5), 1 holding admin,
  per clinic 1 clinic admin/2 front desk/3 doctors, and 2 demo patients per
  clinic (one adult, one minor, to exercise the guardian-fields path) — not
  yet the full 60-patients/30-medicines/6-months-of-history §11 describes.
  Same phased approach the prior project used: full realistic seed data
  builds up incrementally as the milestones that actually exercise it land
  (medicines with M4b, real consultation/payment history with M4, six
  months of backdated activity once there's something to backdate).
  `prisma/seed.ts` is idempotent (clears its own prior output before
  recreating) rather than upsert-based, since a fixed dev dataset doesn't
  need partial-update semantics.
- **Dev password**: one fixed password (`FamilyFirst2026!`) shared by every
  seeded account, printed to console by `npm run db:seed`, never committed
  in plaintext anywhere else. `mustChangePassword` defaults to `true` on
  every seeded user (§10); the forced-change flow itself isn't built yet —
  not scheduled to a specific milestone in §12, same gap the prior project
  flagged for its own analogous field.
- **Patient DTO** (`lib/dto/patient.ts`) is a field allowlist that also
  derives `age`/`isMinor` at read time (§6: "never store age") — no money
  fields exist on Patient at all in this schema, so unlike the prior
  project's DTO there's no "even nested" redaction case to prove; noting
  the difference rather than adding a test for something that can't happen.
- **No `/console/clinics`, `/console/users`, `/console/audit-log`,
  `/console/patients` for a holding admin, or `/staff`/`/doctor` beyond the
  queue stub yet** — `lib/nav.ts` and `middleware.ts`'s role gating are
  wired for them, but the pages themselves are out of M1's scope (schema +
  auth + routing + scoping only). Patients list/detail were built now
  specifically because M1's accept line needs a real page to demonstrate
  the 403 against; the rest land with M2 (patients) and M3 (queue).
