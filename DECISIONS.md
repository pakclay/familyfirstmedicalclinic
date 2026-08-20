# DECISIONS.md

Running log of assumptions made where the spec was silent or where the
environment forced a deviation. Dated, so the owner can correct any of
these. Newest first.

## 2026-08-20 — Phase 3

Scheduling: therapist availability, day-view calendar by branch/therapist,
book → check-in → complete → no-show/cancel, package credit consumption,
front-desk payment recording. Seeded 14 services, 4 packages, 8 rooms,
and Mon–Sat 9–6 availability for the 4 seeded therapists. Verified live in
the browser: booking, check-in, completion (both pay-per-visit and
package-credit paths), the prescription gate blocking a REHAB session and
the OWNER override unblocking it (with the AuditLog entry confirmed),
selling a package, credit consumption incrementing correctly, and the
double-booking guard actually excluding overlapping slots from the picker
(not just the unit tests) after booking a conflicting one.

- **Caught and fixed a real timezone-safety bug before it shipped**: the
  availability engine used `toZonedTime(date, 'Asia/Manila')` followed by
  plain (non-UTC) `Date` getters. That only produced correct results
  because this dev machine's own system timezone happens to be Asia/Manila
  — coincidentally matching the app's target zone and masking the bug in
  every test run. `date-fns-tz`'s `toZonedTime` shifts the instant so its
  **UTC** getters read as the target zone's wall-clock time; reading it
  with non-UTC getters silently depends on the runtime's own timezone
  matching, which is not guaranteed anywhere else (Vercel functions
  default to UTC). Fixed by switching to `getUTCDay()`/`getUTCFullYear()`/
  etc. throughout `lib/scheduling/availability.ts` and
  `lib/scheduling/day-range.ts`. Worth grepping for the same
  `toZonedTime(...).getX()` (non-UTC) pattern in future phases that touch
  dates.
- **Found and fixed a genuine Postgres RLS/Prisma interaction bug**: FRONT_DESK
  could not record any payment at all — every `recordPaymentFor` call
  failed with "new row violates row-level security policy," even though
  the INSERT policy explicitly allows it. Root cause: `INSERT ...
  RETURNING` requires the table's SELECT policy to also pass for the
  returned row, and Prisma's `.create()` always does an implicit
  `RETURNING *`. FRONT_DESK has an INSERT policy on Payment but
  deliberately no SELECT policy (§4.1: "record only, cannot view
  reports") — that exact combination is what broke. Confirmed by testing
  a plain `INSERT` (succeeds) vs. the same `INSERT ... RETURNING`
  (fails) directly against the policy. Fixed by writing Payment rows via
  a raw `INSERT` with no `RETURNING` (`insertPaymentNoReturning` in
  `lib/queries/payments.ts`, shared by `recordPaymentFor` and
  `sellPackageFor`) and constructing the returned DTO from the input
  already in hand, rather than reading the row back — which also means
  the RLS SELECT policy stays exactly as restrictive as the ability
  matrix intends, with no compromise needed. Added a regression test
  (`lib/queries/__tests__/payments.test.ts`) proving FRONT_DESK's write
  succeeds and is correct when read back as OWNER, while FRONT_DESK still
  can't read it — both at the app layer and via the RLS backstop
  directly.
- **Fixed a second RLS/write conflict, inline this time**: completing an
  appointment needs to set `Patient.lastVisitAt`, but THERAPIST has no
  Patient write access at all (write:none on patientDemographics) and RLS
  enforces that literally — so a THERAPIST completing their own
  appointment would hit the same wall. Since the appointment-completion
  authorization has already been checked by that point,
  `completeAppointmentFor` re-presents as OWNER for just that one
  statement (`SET LOCAL app.role = 'OWNER'` mid-transaction, scoped to
  that single write) rather than weakening the Patient RLS policy itself.
  Documented inline in `lib/queries/scheduling.ts`.
- **Route interpretation**: `/intake/[token]`'s booking-driven per-patient
  token variant doesn't exist yet (that's Phase 7) — Phase 3 booking is
  entirely front-desk/staff-initiated (WALK_IN, PHONE, FB_MESSENGER,
  REBOOK sources), no ONLINE source is reachable yet.
- **Day/week calendar**: built as a day view with therapist columns (an
  appointment-card list per therapist, not a pixel-positioned time grid)
  plus prev/next-day navigation — not a true week grid. This reads as
  "day view, easy to move between days" rather than the literal "day/week
  toggle" the spec lists; revisit if a real week-at-a-glance grid turns
  out to matter for how front desk actually works day to day.
  §9's wellness/rehab color pairing is applied to every appointment card's
  left border.
- **No therapist-availability editing UI yet** — availability lives in
  the `TherapistAvailability` table (seeded Mon–Sat 9–6 for the 4 seeded
  therapists) and the booking/slot engine reads it correctly, but there's
  no admin screen to add/change a therapist's hours or time off. The
  `/console/therapists` page is still Phase 0's stub. Not required for
  this phase's "front desk can run a full day" bar (which is about
  running appointments against existing availability, not authoring it),
  but real onboarding needs this before go-live.
- **Package-to-service matching isn't enforced** — a generic package (no
  `serviceId`) can be applied to any service at booking time; the intro
  offer's `serviceId` link isn't currently checked against the appointment's
  service either. Revisit if the owner wants packages restricted to
  specific services.
- **Payment collection is decoupled from appointment completion** —
  "Record payment" is a separate action available on any non-terminal
  appointment (for OWNER/FRONT_DESK), not a forced step at check-in or
  completion. This was a deliberate simplification: forcing exact payment
  timing into the completion flow would have added real complexity for a
  question (when exactly does front desk collect money relative to the
  session) the spec doesn't resolve.

## 2026-08-20 — Phase 2

Permission layer hardened: `scopedPrisma`-equivalent query layer, Postgres
RLS as a real (not theoretical) backstop, role-aware DTOs, and a test
suite proving a THERAPIST 403s reaching money — both at the application
layer and at the database layer, independent of each other.

- **RLS requires a non-superuser database role, which the local dev setup
  didn't have.** Postgres unconditionally bypasses row security for
  superusers — no policy or `FORCE ROW LEVEL SECURITY` setting can change
  that. The `postgres` role this project's local Postgres uses (created in
  Phase 0 for `winget install PostgreSQL`) is a superuser, so RLS policies
  would have silently no-op'd for every query the app makes. Created a
  second Postgres role, `webinar_app` (plain LOGIN, no superuser, granted
  table privileges + default privileges so future migrations' new tables
  stay accessible to it), and split the connection strings:
  `DATABASE_URL` (postgres superuser) for `prisma migrate`/`generate` only,
  `APP_DATABASE_URL` (webinar_app) for the actual running app
  (`lib/db/prisma.ts`). This mirrors how Supabase itself separates the
  migration/owner role from the RLS-constrained runtime role — the pattern
  carries over cleanly whenever this moves to real Supabase.
- **RLS policies define no DELETE rule at all** on Patient/SessionNote/
  Payment/PayoutResult (not "DELETE limited to OWNER" — no policy for the
  command at all, which Postgres treats as a hard deny for everyone,
  `webinar_app` included). This was a deliberate reading of §11's "nothing
  hard-deletes from the UI": rather than trust every future query to
  remember to soft-delete, the database itself now refuses the DELETE
  statement outright for the app's connection. Test fixture teardown
  (`lib/test/superuser-prisma.ts`) uses the migration superuser connection
  instead, which is the correct shape for this — an actual ops/support
  script doing a real purge should look the same way, not paper over it
  with a policy that quietly allows OWNER to hard-delete from the app.
- **`ForbiddenError`** (`lib/permissions/errors.ts`) is the throw-based
  403 the spec asks for ("assert... a forbidden read returns 403, not an
  empty list"). Next.js Server Actions don't have literal HTTP status
  codes the way a REST endpoint would, so a typed, named error that a
  route handler could map to a real 403 later is the closest equivalent
  available in this architecture. Every query-layer function that denies
  access throws it — a role with genuine partial scope (e.g., a
  BRANCH_MANAGER querying another branch's specific patient) still
  correctly gets `null`/`[]`, since that's a real "not found in what you
  can see" rather than "you have no access to this resource at all"; the
  tests check both cases separately so the distinction doesn't blur.
- **Split Phase 1's `lib/actions/patients.ts` into a query layer +
  thin action wrappers** (`lib/queries/patients.ts` now holds the real
  logic, taking an explicit `AbilitySubject` instead of calling
  `requireSession()` itself). This was necessary, not optional, for
  testability: Vitest can construct a fake `AbilitySubject` for any role
  and call the query function directly, hitting the real database and RLS
  policies, without needing to fake a Next.js request/cookie/session.
  `lib/actions/import.ts`'s Patient-touching calls were also rewired
  through `runWithRls()` for the same reason — without it, the importer
  would have started failing under RLS (no GUCs set → every policy
  evaluates to NULL → zero rows/denied writes).
- **`lib/queries/payments.ts` and `lib/dto/payment.ts` are new
  infrastructure with no UI yet** — Payment recording lands with Phase 3's
  scheduling work. They exist now specifically so the Phase 2 "done when"
  (a THERAPIST cannot reach any money figure, proven by test) has a real
  money-bearing resource to test against rather than a hypothetical one.
  `lib/queries/__tests__/payments.test.ts` is the test that matters most
  this phase: it proves THERAPIST/DOCTOR/FRONT_DESK/MARKETING all throw
  `ForbiddenError` calling `listPaymentsFor`, and — independently — that a
  raw, intentionally unfiltered `tx.payment.findMany({})` under each of
  those roles' RLS context still returns zero rows, proving the backstop
  works even if the application-layer check were bypassed or buggy.
- **DTO layer scope**: `toPatientDTO` is an explicit field allowlist, not
  a redaction function — there's no role for which Patient data gets
  money fields stripped, because no query ever selects money onto a
  Patient response in the first place. Its test
  (`lib/dto/__tests__/patient.test.ts`) proves that even if a future
  query carelessly `include`s `patientPackages`/`payments` (both carry
  centavos fields), the DTO still won't forward them — the "even nested"
  half of §4.2's hard rule. `toPaymentDTO` has no redacted variant either,
  by design: a role that can't read Payments is denied before
  `listPaymentsFor` ever calls it, so there's no "money figure with the
  number blanked out" state to model.
- **RLS is applied to exactly the four tables §4.2 names** — Patient,
  SessionNote, Payment, PayoutResult — not the whole schema. Broader
  tables (Assessment, Prescription, Lead, etc.) get the same treatment as
  their features land in later phases; the RLS backstop is scoped
  narrowly for now rather than blanket-enabled on tables no code touches
  yet, matching the "as a backstop" framing (defense in depth behind a
  working application-layer check, not a replacement for one).

## 2026-08-20 — Phase 1

Patients: list/search, profile + timeline, public + front-desk intake with
consent capture, Excel/CSV importer. Verified end to end in-browser as
FRONT_DESK (manual add, public intake submission, processing the intake
queue into a patient) and as OWNER (patient list across branches, search).

- **Front-desk "Add Patient" bypasses `IntakeSubmission` entirely** — it
  calls the same patient-creation path directly rather than creating an
  `IntakeSubmission` with `submittedVia: FRONT_DESK` first. §5 models that
  enum value, implying a front-desk-authored submission record should
  exist, but nothing in §6/§14 requires the extra round trip for a staff
  member typing a walk-in's info directly into the system — an
  `IntakeSubmission` row here would just be a same-request duplicate of the
  `Patient` row it immediately becomes. Revisit if the owner wants a
  submission-level audit trail independent of the patient record itself.
- **Import wizard's file upload step could not be exercised through
  either available browser tool** — the in-app Browser pane's `form_input`
  refuses to programmatically set `<input type="file">` (browsers block
  this for security), and Claude in Chrome wasn't connected this session.
  Instead verified the actual parse → normalize → dedupe → validate
  pipeline (`lib/import/analyze.ts`, `lib/import/normalize.ts`) directly
  against the dev database with a crafted CSV covering a clean row, a
  lenient-format mobile number, a genuine mobile-number conflict, an
  unparseable date, and an invalid mobile — all five classified correctly.
  The wizard's step transitions (map → dry run → review → commit) are
  type-checked and lint-clean but not click-tested end to end. Worth a
  real run with an actual file before trusting this in production.
- **One branch per import run**, not a per-row branch column — §12 doesn't
  specify either way. A spreadsheet is realistically one branch's export at
  a time; multi-branch-per-file adds real complexity for a case that may
  not occur. Revisit if the real spreadsheets mix branches.
- **`importBatchId`** (plain string, not a modeled entity) was added to
  `Patient` beyond §5's explicit field list, to satisfy §12's "wrap the
  import in a transaction tagged with an importBatchId so a bad import can
  be rolled back whole." Rollback is implemented as soft-delete (§11: no
  hard deletes) of every patient the batch created; merges into existing
  patients are not auto-reverted by rollback — the `AuditLog` before/after
  rows have what changed for a manual fix, since automatically un-merging
  would need to know what the operator does and doesn't want undone.
- **Merge semantics**: an import row that matches an existing patient
  (§12's "conflict") only fills fields the existing record has as empty —
  it never overwrites data already in the system. This was a judgment
  call, not a spec requirement; the alternative (overwrite with the
  spreadsheet's values) risks clobbering anything staff have already
  corrected since the last export.
- **Default status for imported patients** is an operator-chosen dropdown
  at import time (defaulting to `ACTIVE_PROGRAM`), not inferred from the
  spreadsheet — §12 doesn't specify a source column for this, and guessing
  a clinical status from raw Excel data risked being wrong in a way that's
  hard to notice later.
- New dependencies (`exceljs`, `papaparse`) pulled in a moderate `uuid`
  advisory and reintroduced the `deepmerge-ts`/`@prisma/config` high
  advisory already noted in Phase 0 as a Prisma-tooling transitive (dev/
  build-time only, not shipped in the client bundle). Not blocking; flag
  if `npm audit` needs to go clean before a real deploy.

## 2026-08-20 — Phase 0

### Open questions from §15 — still unanswered, not yet blocking

None of §15's seven questions block Phase 0 (schema is fully specified in
§5; Phase 0 seed data is intentionally fictional). They will start blocking
real work at these points:

1. **Branch list, addresses, hours** — blocks real seed data quality now;
   blocks the public `/branches` page in Phase 7. Placeholder branches were
   seeded (`SF-CT`, `SF-SN`, `ANG-1`, a 4th "identity pending" branch, and a
   5th inactive "opening soon" branch) using only the three locations named
   in the product brief (San Fernando Capital Town, San Fernando Sto. Niño,
   Angeles City). **The 4th active branch and the 5th branch's actual
   location are invented placeholders** — ask before Phase 1's Excel import
   needs real branch codes to map against.
2. **Service menu, prices, commissionable flags** — blocks Package/Service
   seed data and the booking flow (Phase 7). Not yet seeded.
3. **Real quota rules for one past month** — blocks the quota engine
   (Phase 5). The worked example in §7.2 is sufficient to build and test
   `computePayout()` against; the *real* scheme (tiers, thresholds, payout
   amounts) still needs the owner's numbers before Phase 5 ships.
4. **HMO billing in MVP scope** — `PaymentMethod.HMO` exists in the schema
   per §5's exact field list; no HMO claims workflow is implied or built.
   Confirm before Phase 3/8 payment reporting.
5. **In-house vs. shared/remote doctor** — affects the doctor-review queue
   UX (Phase 4). Not yet built.
6. **Brand assets (logo, hex, fonts)** — none supplied. Using §9's fallback
   palette (`ink #14181B`, `paper #F4F6F5`, `line #D9DFDD`, `wellness
   #0E8F86`, `rehab #C3562F`, `signal #E4B53F`) and fonts (Archivo/Inter/IBM
   Plex Mono) verbatim, wired into `app/globals.css` now so every phase
   after this one inherits the real palette once supplied — just swap the
   hex values in `:root`.
7. **Excel row count / columns** — blocks the Phase 1 importer's column
   mapper. Need a de-identified sample before that phase starts.

### Environment setup

- **Node.js was not installed** on the dev machine. Installed Node.js LTS
  (v24.19.0) via `winget install OpenJS.NodeJS.LTS` with the user's
  confirmation.
- **No Supabase project existed yet.** Per the user's choice, Phase 0 runs
  against a local PostgreSQL 17 instance (installed via winget) instead —
  `postgresql://postgres:postgres@localhost:5432/stretchlab_dev`. Swapping
  to real Supabase (Singapore region) is a one-line `DATABASE_URL` change
  in `.env` when the owner provisions it. Nothing in the schema depends on
  Supabase-specific features yet (RLS policies land in Phase 2 and are
  standard Postgres, portable to either).

### Stack deviations from the spec table

- **Next.js**: spec pins v15; `create-next-app@latest` installed v16 by
  default. Downgraded to `next@15.5.23` (latest 15.x) to match the spec
  exactly. This carries 3 known high-severity transitive advisories
  (postcss, sharp/libvips) that are only fixed by the v16 bump — acceptable
  for now since this is a local admin console, not public-facing; revisit
  if the spec owner approves the major version bump later.
- **Prisma major version**: spec doesn't pin a Prisma version. `npm install
  prisma@latest` pulled v7, which requires connection URLs to move out of
  `schema.prisma` into a new `prisma.config.ts` + driver-adapter setup —
  a significant, very recent architecture change not reflected anywhere in
  the spec or in most existing documentation/tooling. Pinned to `6.19.3`
  instead (latest 6.x), which keeps the standard `datasource { url =
  env("DATABASE_URL") }` pattern the rest of the ecosystem still assumes.
  Revisit the v7 move once its driver-adapter pattern is more established.
- **Auth session strategy**: the spec doesn't specify a session strategy.
  Auth.js's Credentials provider **only supports JWT sessions**, not
  database sessions (a hard framework constraint, not a choice made here).
  "Owner can revoke a session immediately when someone resigns" (§11) is
  instead enforced by re-checking `User.isActive` / `deletedAt` against
  Postgres inside the `jwt` callback on every request — a deactivation
  takes effect on that user's very next navigation, not necessarily
  mid-request on an already-open tab. Documented in `auth.ts`. No
  `Account`/`Session`/`VerificationToken` adapter tables exist in the
  schema as a result — they're only needed for database sessions or OAuth,
  neither of which apply here.
- **npm's `allow-scripts` gate**: this npm install blocks postinstall
  scripts by default until approved (`npm approve-scripts`). Approved it
  for `prisma`, `@prisma/client`, `@prisma/engines`, `sharp`, `esbuild`,
  and `unrs-resolver` — all direct, well-known transitive deps of
  Next.js/Prisma/Tailwind, not third-party additions.
- **shadcn/ui base**: the current shadcn CLI supports three primitive
  libraries (Radix, Base UI, React Aria). Chose **Radix** (`nova` preset)
  since it's the long-standing default most tooling/AI knowledge assumes.
  The `form.tsx` wrapper (react-hook-form + shadcn Form primitives) isn't
  shipped by the current CLI registry for this base — hand-written to match
  the classic shadcn pattern.

### Route layout deviation from §3's ASCII diagram

The spec's repo layout shows `/app/(console)/therapists` (a staff roster)
as a sibling of `/app/(public)/therapists` (the public therapist-picker
page) — both would resolve to the same `/therapists` URL under Next.js
route groups, which is a genuine collision, not a stylistic choice. Put the
console under a real `/console` path segment (`app/console/...`, not a
route-group parenthesis) instead, so `/console/therapists` (staff) and the
future `/therapists` (public) don't clash. `(public)` route group is not
yet created — Phase 0 only needed a placeholder `/` and `/login`; the full
public site route group scaffolds out in Phase 7.

### Schema notes worth flagging

- `createdById` (present on every table per §5's base-fields rule) is a
  plain scalar column, **not** a Prisma relation. Formalizing it as a real
  FK to `User` on all ~25 tables would mean ~25 uniquely-named back-relations
  on the `User` model for no query benefit Phase 0–2 need. Revisit if a
  later phase needs to join through it.
- `FollowUpTask.subjectId` (§6's polymorphic Lead-or-Patient follow-up
  target) is a plain scalar, not a Prisma relation — a single column can't
  hold two simultaneous foreign-key constraints (one to `Lead`, one to
  `Patient`) without requiring the id to exist in both tables. Resolved via
  `subjectType` in application code once follow-ups are built (Phase 6).
- `CarePlan.status` enum values (`ACTIVE | ON_HOLD | COMPLETED |
  DISCONTINUED`) and `TherapistProfile.employmentType`
  (`FULL_TIME | PART_TIME | CONTRACTOR`) aren't enumerated in §5 — inferred
  reasonable values. Flag if the owner wants different states.
- Added `AppSetting` (key/value + Json) and `MessageTemplate`/`MessageLog`
  models beyond §5's explicit list, since §8 and §11 reference an
  owner-editable Settings table and a template/log system without spelling
  out their fields. Will refine field shapes when Phase 6 (CRM/follow-ups)
  and the notification adapters are actually built.

### Phase 0 seed scope

Seeded only branches + one staff account per role (12 users total, per
§13's staff count) — not the full 220 patients / 1,400 appointments / 90
leads / quota periods §13 describes. Phase 0's own "done when" bar is
"log in as each role, see a different nav," which doesn't need that data,
and faking it now against schema no feature has exercised yet risks
needing rework once Phase 1–6 land the real business logic it should
satisfy. Full realistic seed data builds up incrementally: patients in
Phase 1, appointments in Phase 3, leads in Phase 6, quota schemes/payouts
in Phase 5.

Dev login: all 12 seeded accounts share password `StretchPH2026!`
(`mustChangePassword: true` is set on every account; the forced-change flow
itself isn't built yet — that's a Settings/Users & access control feature,
not explicitly scheduled to a numbered phase in §14).
