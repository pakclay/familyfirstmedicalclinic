# DECISIONS.md

Running log of assumptions made where the spec was silent or where the
environment forced a deviation. Dated, so the owner can correct any of
these. Newest first.

This repo previously held a different product (Stretch Lab PH, a stretch/
rehab therapy console). That build's own decisions log is preserved in git
history (`git log -- DECISIONS.md`) but doesn't apply to anything below —
this is a fresh log for Family First Medical Clinic.

## 2026-08-29 — Triage vitals on the visit

Vitals already existed, as `consultations.vitals`, but only a doctor could
ever write them: a Consultation row requires a `doctor_id` and is created
by `saveConsultation`, after the patient has been seen. Vitals are taken at
triage, before any of that exists, so the people who actually measure them
had no write path at all.

- **Columns on `queue_entries`, not a `vitals` table.** queue_entries
  already carries the branch RLS policies from the branch refactor, so
  these ride along on the existing row and inherit that isolation exactly.
  A separate table would need its own SELECT/INSERT/UPDATE policies, and
  that is the part this codebase has already demonstrated is easiest to get
  wrong. Cardinality agrees: one reading per visit, whereas consultations
  carry revisions and would duplicate vitals across every revision of the
  same encounter.
- **`consultations.vitals` is kept, not moved.** It stays the doctor's own
  reading at the encounter; the queue entry holds triage's. The two are
  allowed to differ — a patient reweighed in the consultation room is not a
  data conflict, and collapsing them would force one of the two readings to
  be silently overwritten by the other. The consultation form prefills from
  triage and says so, but editing there does not write back.
- **Readings are validated now, and were not before.** The old schema
  accepted any string, so a temperature of "999" or a typo'd weight of
  "700" was stored verbatim and shown to a doctor as fact. Ranges bound what
  a living patient can plausibly measure rather than what is healthy — a
  reading can be alarming and still be real. Both forms import one schema,
  so a reading cannot be accepted at triage and rejected in the consultation
  room.
- **Kept as strings rather than numbers.** The JSON column already held
  strings, and changing the value types would silently invalidate every
  reading recorded before today. Blood pressure has no numeric
  representation anyway, so the column was never uniformly numeric.
- **An empty save is refused rather than written as `{}`.** It would stamp
  a recorder and a timestamp onto a reading that does not exist, which the
  UI then presents as "vitals were taken" — worse than showing nothing.
- **The audit row records which fields were taken, never the values.**
  Measurements are clinical data belonging to the visit; `audit_logs` is
  readable by every holding admin in the company and retained far longer
  than the reading is clinically current. A test asserts the values do not
  appear in the row.
- **A correction overwrites rather than appends.** A stale pulse left
  beside a corrected temperature reads as both having been measured. Visit-
  level history is not kept here; the consultation snapshot is the durable
  clinical record.
- **The backfill was verified separately, because it had nothing to do.**
  It copies the latest non-deleted consultation revision's vitals onto its
  queue entry, but no seeded consultation carries vitals, so the migration
  ran against zero rows. The UPDATE was replayed against purpose-built rows
  to confirm it picks the highest revision and ignores a soft-deleted later
  one — a backfill that silently picked the wrong revision would be
  invisible until someone opened an old visit.
- **Not verified in a browser.** The dev session had expired and signing in
  means typing a password, which is not something to do on the owner's
  behalf. The queue board's vitals form typechecks and the server compiles
  clean, but nobody has clicked it.

## 2026-08-29 — Issuing a replacement temporary password

An account created through the console gets a generated password shown
exactly once and stored only as a bcrypt hash. Lose that, and the account
was unreachable: the only remedy was deleting and recreating it, which
stops being available the moment anything references the row. Surfaced by
a real account in the dev database — created, never signed into, password
gone.

- **`forcePasswordReset` looked like the recovery path and was not.** It
  raises `mustChangePassword` and nothing else, so the account still needs
  its *current* password to sign in and change it — exactly what is
  missing. The name and its placement next to "Unlock account" both
  suggest otherwise, which is how it went unnoticed. Both actions are kept:
  forcing a change on a password the holder still knows is a different
  operation from replacing one nobody knows.
- **Refused for the actor's own account, and this is a real boundary.**
  `changeOwnPassword` requires the current password, so a stolen session
  cannot rotate its own credentials today. Allowing self-service here would
  hand it precisely that, letting an attacker lock the genuine owner out of
  their own account. An admin who has lost their own password needs another
  admin, which is the same shape as `setUserActive` refusing self-
  deactivation — checked before `canManageTarget` for the same reason, so
  the answer is the real one rather than a misleading "not found".
- **Issuing a password clears the lockout.** A lockout counts failed
  attempts against the *old* password; leaving it would block the new one
  too and make the action appear not to have worked. Bundled into the same
  update rather than left as a second button the admin has to know to press.
- **The audit row records that a password was issued, never its value.**
  `audit_logs` is readable by every holding admin in the company and
  retained far longer than a temporary password stays valid. A test asserts
  the serialized row does not contain the plaintext, so this cannot regress
  quietly.
- **The test asserts the returned password actually authenticates**
  (`bcrypt.compare` against the stored hash) and that the previous one no
  longer does. Checking only that a string came back would pass against a
  function that generated one password and stored a different one — and
  against one that added a second valid credential instead of replacing the
  first.
- **Not verified in a browser.** The dev session had expired, and signing
  in means typing a password, which is not something to do on the owner's
  behalf. Covered at the query and type layers instead; the button itself
  is unexercised.

## 2026-08-29 — Administration page, and staff management by clinic and branch

The console could create branches but had no way to see or staff them.
`/console/clinics` listed clinic names with no sense of size, and
`/console/users` listed every account in the company with no sense of
where it sat. Neither answered the questions someone opening the console
actually has.

- **A user attaches to a branch, not a clinic**, so "this clinic's staff"
  is the union across its branches (`listUsersForClinic`) and there is no
  `clinicId` on the row to filter by. Holding admins are structurally
  absent from that list — their `branchId` is null, so they match no
  clinic and would otherwise appear identically under every one of them.
  `/console/admin` has a dedicated section for them; before it, the flat
  user list was the only place they existed.
- **Moving a user between branches updates `Doctor.branch_id` in the same
  transaction.** It is a second non-nullable column, not a view of the
  user's — leaving it behind would list a doctor in one branch's
  assignment picker while their account lived in another. Holding-admin
  only: `canManageTarget` already confines a clinic admin to their own
  branch, so letting them move someone out of it would be a one-way exit
  from their own scope.
- **A doctor with unfinished queue entries cannot change branch.**
  `assignDoctor` only ever attaches an in-branch doctor, so moving one out
  from under a live entry strands it. The first version of this guard
  could never fire: it counted on the bare Prisma client, and
  `queue_entries` is RLS-protected, so with no GUCs set the policy matched
  nothing and the count was always zero. It now runs inside `runWithRls`.
  Both halves are tested — refuses while the entry is live, allows once it
  is finished — because a guard that blocks everything and one that blocks
  nothing are indistinguishable from a single passing assertion.
- **The admin page reports gaps, and adds no mutations of its own.**
  Every row links into a page that already does the work. Three of the
  gaps are joins no existing screen makes; *active accounts still attached
  to a deactivated branch* is one the app previously could not express at
  all, since the clinic pages never load users and `UserDTO` carries
  `branchName` but not the branch's `isActive`. Those people can still
  sign in while their branch is closed.
- **Locked-out is queried against `lockedUntil` directly.** `isLockedOut`
  is derived in JS inside `toUserDTO`, so it is not filterable or
  countable through that surface at any layer. Every gap and every count
  in one overview share a single `now` so they cannot disagree with each
  other.
- **The gate throws `ForbiddenError`, not `requireHoldingCompanyId`'s
  plain `Error`.** This backs a top-level nav destination, and an account
  not attached to a company is a data state to refuse cleanly rather than
  a 500. The attention lists are capped while their counts are not, so
  "showing 8 of 20" is correct rather than inconsistent.
- **The stat tile says "Accounts", not "Staff".** It counts company-level
  admins too, so it is deliberately larger than the per-clinic numbers
  below it — noticed only by checking that the clinic counts summed to one
  less than the total.
- **Replaced the holding admin's dashboard stub**, which still promised
  "Consolidated reporting lands in M6" long after `/console/reports`
  shipped it. Three lines, and it removes a false statement from the first
  page that role sees.
- **Verified live**, since query tests cannot prove a page renders: the
  attention panel found real problems in seeded data (two active branches
  with no staff, one account still on its temporary password), and the
  stranded-account panel was confirmed by closing a staffed branch,
  observing all six accounts surface, and reopening it.
- **Noted, not fixed:** `User` has no index on `branchId` or `role`, and
  the new admin and staff queries filter on both. Irrelevant at current
  data size, a migration when it isn't.

## 2026-08-29 — Holding-company scoping on cross-branch reads

A holding admin of one company could read *and manage* every other
company's clinics, branches and accounts. `listClinics` issued a bare
`findMany` with no `where`; `listBranches` filtered only on an optional
`clinicId`; `listUsers` used `where: {}` for that role; and because
`canManageTarget` returns plain `true` for a holding admin, the five
single-user lookups behind it went by id alone — so the reach was write
access, not only disclosure.

- **This is the same bug the audit log viewer already had, in the same
  week.** That entry (2026-08-23) records it being caught in review and
  spells out the hazard exactly: an unfiltered read "would list every
  account name and every branch in the entire database to any holding
  admin". The fix was applied to `audit-log.ts` and never to its
  neighbours. Worth treating as a pattern rather than two incidents —
  these tables carry no RLS, so *every* cross-branch read needs the
  predicate written by hand, and nothing in the type system asks for it.
- **Writes were already correct.** `createClinic` and `createUser` stamp
  `holdingCompanyId`. The tenant was recorded faithfully and then ignored
  on the way back out, which is why nothing looked wrong in the data.
- **The bound is a where-clause, not a check after the fetch**, so
  another company's row reads as "not found" — the answer
  `getManagedUserById` already gives for "exists but not yours" — and a
  caller-supplied `clinicId` narrows within the company without ever
  reaching past it.
- **`requireHoldingCompanyId` throws rather than returning null**, so a
  company-less holding admin fails loudly instead of silently widening to
  the whole database. With no RLS underneath, a quiet empty scope and a
  quiet unbounded one look the same from the call site.
- **The entire suite passed before and after the fix.** Every fixture in
  the repo builds a single holding company, where "every row" and "my
  company's rows" are the same set, so no existing test could observe the
  difference. `tenant-isolation.test.ts` builds two. Its first test is the
  control — company B's own admin *can* see B's data — because otherwise
  every "A cannot see B" assertion would also hold against a query that
  returned nothing to anyone.

## 2026-08-29 — Branch tier between clinic and operational data

A clinic can run more than one physical location, but every operational
table hung off `clinic_id` directly, so a second location meant creating
a second "clinic" and a fake holding company to group them. `Branch` now
sits between them: `Clinic` keeps the shape `HoldingCompany` already had
and becomes purely organizational, while `Branch` takes the operational
fields (`slug`, `address`, `city`, `phone`, `facebookPageUrl`,
`timezone`, `operatingHours`, `isActive`) and the `branch_id` that
patients, queues, consultations, inventory and money are scoped by.

- **Six migrations, expand/backfill/contract**, so it runs against
  existing data rather than only a fresh database. Steps 5 and 6 are
  destructive, and step 4 (the RLS rewrite) has to land before step 5
  because Postgres refuses to drop a column a live policy depends on.
- **The backfill copies each clinic's slug verbatim onto its default
  branch**, which is what keeps `/book/{slug}` and `/display/{slug}`
  resolving unchanged for links already shared publicly. It reads the
  `clinics` table rather than hardcoding any known clinic, so dev and prod
  take the same path.
- **`branches` deliberately gets no RLS policy**, matching `clinics`
  before it: the public booking and display routes resolve a branch with
  no session and therefore no GUCs, so a policy there would make that
  unauthenticated lookup return nothing.
- **The RLS rewrite is table-for-table and command-for-command identical**
  to what it replaces — same 11 tables, same SELECT/INSERT/UPDATE shape,
  and the four append-only tables still deliberately get no UPDATE policy.
  Checked by reading both migrations side by side rather than by trusting
  the diff.
- **Tests now cover the boundary the refactor introduces: two branches
  under the *same* clinic.** The previous suite only proved cross-clinic
  isolation, which a regression that scoped to clinic instead of branch
  would have passed. Every RLS test carries a positive control — the same
  unfiltered query with only `app.branch_id` changed — because without it
  a policy that hid every row would read as correct isolation.
- **The app-layer 403 tests cannot fail on their own.** With RLS intact,
  dropping a `branchId` predicate still yields a null lookup and the same
  `ForbiddenError`, so they prove *the system* denies rather than that
  *the app layer* does. The two layers mask each other by design; this is
  a limit on what that half of the suite can detect, recorded so it is not
  mistaken for per-layer coverage.
- **No table defines a `FOR DELETE` policy**, so a cross-branch DELETE has
  no possible positive control — the app role cannot delete its own rows
  either. Left untested rather than asserted vacuously.
- **`prisma generate` had to be added to the build.** Vercel installs
  clean and ran `next build` directly, so it type-checked against a client
  generated from the pre-Branch schema — roughly 90 errors that appeared
  nowhere else, because every other machine had a generated client lying
  around.
- **Noted, not fixed:** `getConsultationScreenData`'s prior-history query
  has no app-layer branch predicate and rests on RLS alone, and it returns
  the most sensitive PHI in the system. Several denials are also silent or
  untraced — `getMedicineWithLedger` returns null with no audit row,
  `listPatientConsultationHistory` returns `[]`, and
  `sendFollowUpReminder` throws from inside its transaction so its audit
  row rolls back with it.

## 2026-08-23 — Audit log viewer (holding admin only, read-only)

The last unbuilt item in §9's Holding Admin route list. `lib/nav.ts`
already linked to `/console/audit-log`, and that link 404'd until now.
Read-only throughout: `audit_logs` is append-only, so there is no edit,
no delete, and no mutation of any kind in this feature.

- **Postgres RLS is NOT the tenant boundary on this table, and assuming
  it was would have leaked every other owner's audit trail.** Unlike
  `clinics`/`users`/`doctors`, `audit_logs` *does* carry an RLS policy —
  but its holding-admin branch is a blanket
  `current_setting('app.role') = 'HOLDING_ADMIN'` bypass that says nothing
  about *which* holding company the reader belongs to. §4 scopes a Holding
  Admin to "all clinics under the holding company", so the narrowing has
  to happen in the query, exactly as `getHoldingConsolidatedReport`
  already does for its clinic list. The first implementation left it out
  and documented the omission as deliberate; review caught it. The test
  databases already contain several holding companies, so this was live,
  not theoretical.
- **The scope spells out all three shapes a visible row can take** rather
  than doing a plain join, because a join on `clinic.holdingCompanyId`
  would erase every `clinic_id IS NULL` row — the holding-level actions
  §10 most wants preserved. A row is visible if it belongs to one of the
  owner's clinics, or is clinic-less but written by one of their own
  people, or is clinic-less *and* user-less (a system/job row).
- **System rows are shown to every holding admin — a deliberate
  compromise.** `retention.purge` (`lib/retention/purge.ts`) runs from the
  CLI with no session, so it has neither a `clinicId` nor a `userId` to
  scope by. Excluding it would mean a background job that permanently
  deletes patient records is auditable by nobody at all. With more than
  one holding company this does reveal aggregate purge counts across
  tenants; the right fix at that point is a separate system-activity log,
  not dropping the rows.
- **Filters are AND-ed with the holding scope, never merged into it**, so
  no filter value can widen what it allows — a hand-edited
  `?clinicId=<another owner's clinic>` intersects to nothing instead of
  reaching across the boundary. The `clinics` and `users` dropdowns are
  holding-scoped too: neither table has an RLS policy, so an unfiltered
  read there would have listed every clinic and every account name in the
  database even while the log itself behaved.
- **Ordering is `[createdAt desc, id desc]`, not `createdAt` alone.**
  Audit rows are routinely written several at a time inside one
  transaction and share a timestamp to the microsecond. Postgres
  guarantees no order among tied rows, so with `skip`/`take` the same row
  can appear on two pages while another never appears at all. A test seeds
  five rows in one transaction at one exact instant, walks them two at a
  time, and asserts the union has no duplicates and no omissions.
- **No default date window.** The reports helper defaults to the last 30
  days, which is right for a report and wrong for an audit trail — one
  that silently hides anything older than a month is worse than useless.
  The timezone helper is still reused for the calendar-day arithmetic;
  only the bound the caller actually supplied is applied.
- **Page size is clamped, not trusted** (default 50, max 200). An
  unclamped `take` off a query string is a one-request denial of service
  against a table that grows forever.
- **Viewing the audit log does not write to the audit log.** §10 requires
  a row on access to patient clinical data and on financial record
  changes; this screen reads *metadata about* those events, never their
  content. Logging it would be uniquely self-amplifying — every page view
  and filter tweak appending into the very table being paged — and would
  turn a read-only route into a write path. The counter-argument (an
  audit log nobody can audit is a gap) is real; the answer is a separate
  access-log sink, not recursion into this table. Reasoning is recorded in
  the query file so it reads as a decision rather than an oversight.
- **Verified the RLS wrapping is actually load-bearing, twice.** A read
  of this table through the bare `prisma` client returns zero rows
  *silently* — no error — which is indistinguishable from an empty table,
  so a test asserting only "an array came back" would pass against a
  completely blind query. Temporarily swapping `runWithRls` for a plain
  client made 19 of 29 tests fail; restoring it returned them to green.
  The same technique confirmed the new tenant-scope tests: neutralising
  the holding scope fails 7 tests, so they would have caught the original
  bug.
- **Verified live**, since the query tests can't prove the page renders:
  created a user in the Makati clinic and confirmed the resulting
  `user.created` row appeared attributed to that clinic with the actor's
  name resolved, while a clinic-less `user.password_changed` row rendered
  an em-dash; confirmed the action/entity dropdowns listed exactly the two
  actions actually present (proving they come from a `DISTINCT`, not a
  hardcoded list); confirmed the clinic filter narrowed 2 rows to 1;
  confirmed `?pageSize=999999&page=9999` clamped instead of crashing or
  serving a blank table; and confirmed a Clinic Admin gets a refusal with
  zero rows and no nav link.
- **Noted, not fixed:** every pre-existing audit row in the dev database
  had a null `clinic_id`. `AuditLog.clinic` is an optional relation, so
  Prisma's default `SetNull` blanks `clinic_id` when a clinic is deleted —
  which is what test-suite teardown does. Harmless in production, where
  clinics are deactivated rather than deleted, but it means orphaned audit
  rows lose their clinic attribution permanently. Worth a look if audit
  retention ever matters more than it does today.

## 2026-08-23 — Clinic settings self-service (clinic admin edits their own clinic)

Third of the four gaps. §4 gives Clinic Admin "clinic hours, services and
prices"; §11 lists "clinic settings (hours, services, prices)" as one of
their routes. What that actually decomposes to, once checked against the
schema, is much smaller than it reads:

- **"Services" does not exist and was not invented.** The word appears
  exactly twice in SPEC.md, both times in a role/route list, and never in
  §6 where every other entity gets a defined table — no `services` table,
  no column, no relation. Rather than design a schema for a concept the
  spec never specified, this is recorded as an open question for the
  owner. Decide what a service *is* (a name and a price? something a
  patient picks at booking? something a consultation records?) before any
  table gets added, because each answer implies a different shape and the
  wrong guess would be embedded in a migration.
- **"Prices" needed nothing here.** Per-doctor consultation fees are
  already editable through Users management (`Doctor.consultationFee`),
  and medicine prices through the existing inventory catalog — which §11
  itself lists as a *separate* clinic-admin capability. So the only real
  gap was hours plus the clinic's own contact details.
- **The new query functions take no clinic id at all.** §5's hard rule is
  that clinic scoping comes from the authenticated user's assignment and
  "never from a client-supplied parameter." `getOwnClinic(actor)` and
  `updateOwnClinicSettings(actor, input)` resolve the clinic internally via
  `requireClinicId`, so there is no parameter for a caller to point
  elsewhere — a clinic admin cannot reach another clinic's row even if the
  action layer were bypassed entirely. The form payload carries no id
  either.
- **Deliberately separate functions rather than relaxing
  `listClinics`/`getClinicById`.** Both of those throw for a
  non-holding-admin, and the review of the clinics feature specifically
  predicted that a future clinic-settings page wired to them would be the
  regression to avoid. It was: this is that page.
- **`clinicSettingsSchema` lists its allowed fields rather than
  `.omit()`-ing from `editClinicSchema`.** The omitted keys (`name`,
  `slug`, `timezone`) are exactly the privilege boundary, so an allowlist
  makes a future addition to `editableClinicFields` fail closed instead of
  silently widening what a clinic admin can edit. The query layer likewise
  writes each column by name instead of spreading the validated input.
- **Name, slug and timezone stay holding-admin-only.** The name is on the
  public booking page and in holding-level reports; the timezone drives
  queue numbering, report ranges and follow-up dates; the slug is
  immutable everywhere. A clinic admin sees all three on the page as
  read-only context with a note saying who manages them.
- **`getOwnClinic` refuses a holding admin with `ForbiddenError` rather
  than letting `requireClinicId` throw.** That function's null-clinicId
  throw is a plain `Error` meaning "the programmer forgot to branch on
  `isHoldingAdmin`" — it would surface as a 500. This is a role boundary,
  so it gets the 403-equivalent. It gates on *having* an own clinic rather
  than on being a clinic admin, because everything it returns is already
  public on `/book/{slug}`; the write path carries the strict role check.
- **The weekday-hours editor was extracted before its third copy.** It was
  already duplicated across the create and edit clinic forms — noted at
  the time as "the first thing to extract if that editor grows." It grew.
  `app/console/clinics/operating-hours-fields.tsx` now owns the markup,
  the Closed-checkbox behaviour, and the hydrate/serialize helpers, and
  all three forms use it.
- **Verified live**, including that the extraction did not regress the two
  existing forms: the create form still defaults to Mon–Sat open/Sunday
  closed; typing a custom Monday time, ticking Closed, then unticking it
  restores that custom time rather than the default (the behaviour the
  shared component exists to preserve) and leaves other days untouched;
  the edit form still hydrates seeded hours correctly. Then as a clinic
  admin: changed the phone and Monday opening time and closed Saturday,
  confirmed all three persisted, confirmed `clinic.settings_updated` was
  audit-logged (which is also the proof `runWithRls` was used, since
  `audit_logs` has an RLS policy and `clinics` does not), and confirmed
  name/slug/timezone/isActive were unchanged. A holding admin visiting the
  page gets a pointer to /console/clinics rather than a crash. Dev
  database reseeded afterward.

## 2026-08-23 — Clinics management (holding admin only)

Second of the four gaps found when asking why there was no Clinics input
page (after Users management, same day). §4's role table gives Holding
Admin "Create clinics" and gives Clinic Admin no say over clinics at all,
so unlike Users — which both admin roles share, scoped differently —
this surface is single-role throughout.

- **A forbidden read throws, it does not return an empty list.** The
  first pass had `listClinics` return `[]` for a non-holding-admin,
  justified in a comment as "matching listUsers." That justification was
  wrong on the facts: `listUsers` has no role gate at all — it
  clinic-scopes its `where` via `requireClinicId`, so every caller
  legitimately gets rows, and `[]` is never a permission outcome there.
  `lib/permissions/errors.ts` states the actual rule ("§4.2 requires a
  forbidden read to fail as a 403-equivalent, never silently degrade to
  an empty list"), and every other role-gated read in `lib/queries`
  throws — `reports/holding.ts`'s `getHoldingConsolidatedReport`, the
  closest analogue since it's also holding-admin-only, throws
  `ForbiddenError`. Fixed to throw. The failure this prevents is
  specific: "clinic settings self-service" is a planned future page for
  Clinic Admins, and a maintainer wiring it to `listClinics` behind a
  looser gate would have gotten a plausible, successfully-rendered "No
  clinics yet." screen instead of a 403 — a broken authorization check
  rendering as ordinary empty state.
- **`getClinicById` throws on the role check but still returns null for
  an unknown id** — deliberately *not* `getManagedUserById`'s
  null-for-both shape. There, both admin roles are legitimate callers and
  null distinguishes "not one you manage" among them, which is real
  non-enumeration. Here a non-holding-admin has no business calling it at
  all: that's a role denial, not a missing row, and collapsing the two
  would hide the same class of bug as the bullet above.
- **The slug is immutable after creation.** It's the public identity of
  the clinic — `/book/{slug}` gets pasted into Facebook chats and
  `/display/{slug}` runs on a waiting-room screen — so a rename would
  silently break links already in patients' hands. `editClinicSchema`
  omits it entirely rather than validating it, and the edit form renders
  it disabled with a note saying why.
- **Deactivating a clinic is the closest thing to deleting one**, and it
  correctly takes the public booking link offline: `lib/queries/booking.ts`
  already resolves slugs with `where: { slug, isActive: true }`, so no new
  code was needed for that. Verified live end-to-end (below). Inactive
  clinics stay *visible* in the console list with a badge rather than
  being filtered out — the deactivated one is exactly the one an admin
  needs to find in order to reactivate it.
- **`toClinicDTO` normalizes `operating_hours` rather than casting it.**
  The column is untyped JSON and pre-existing rows can hold anything
  (the seed's shape, other test suites' `{}` fixtures), so unrecognized
  or missing weekdays become `null` instead of throwing mid-render.
- **Built via a multi-agent workflow** (one implementer, three
  independent reviewers — RLS/data-safety, permission scoping,
  convention consistency — then adversarial verification of each
  finding). Two dimensions came back clean; the one surviving finding was
  the `return []` above, which was traceable to a wrong instruction in
  the implementer's own brief rather than to the implementation.
- **Verified live against the real dev database**, not just the 11-case
  test suite: created a clinic through the actual form (including the
  per-weekday "Closed" checkboxes), confirmed the hours round-tripped
  exactly on reload (Mon closed, Tue–Fri 09:00–18:00, Sat 08:00–12:00,
  Sun closed), confirmed the new clinic was immediately live at
  `/book/davao` with the right name and address, deactivated it and
  confirmed that link 404s, reactivated it and confirmed the link
  returns. Then signed in as a Clinic Admin and confirmed all three
  routes (list, `[id]`, `new`) refuse with no clinic data rendered and
  no "Clinics" link in that role's nav. Dev database reseeded afterward
  to drop the test clinic.

## 2026-08-23 — Users management (holding admin: any account, clinic admin: own clinic's front desk/doctor)

Scoped from "why was there no Clinics input page?" — SPEC.md §4 gives
Holding Admin "manage all users" and Clinic Admin "manage doctors and
staff," and `lib/nav.ts` already linked to `/console/users`, but no
milestone ever had it as an accept-criterion, so it was never built.
Built Users first of the four gaps found (Users, Clinics, clinic
settings self-service, audit log viewer), since it extends the
password/lockout work from issue #7 rather than starting cold.

- **`users`, `doctors`, and `clinics` have no RLS policy at all** —
  confirmed against `prisma/migrations/20260821145450_enable_rls_backstop/
  migration.sql`, which only covers `patients`, `queue_entries`,
  `consultations`, `medicines`, `stock_movements`,
  `medicines_dispensed`, `payments`, `remittances`, `expenses`,
  `notifications`, `audit_logs`. A prior code comment in
  `lib/queries/users.ts` had this backwards (claimed the `users` policy
  was "clinic-scoped, not self-scoped" — there is no policy at all) and
  has been corrected. Every function in that file filters explicitly by
  clinic/role in application code rather than leaning on a database
  backstop the way patient/queue/payment queries can.
- **`audit_logs` *does* have an RLS policy, though, and every mutating
  function here writes one.** First pass used a plain
  `prisma.$transaction(...)` for `createUser`/`updateUser`/
  `setUserActive`/`forcePasswordReset`/`unlockAccount`, which meant the
  `tx.auditLog.create(...)` inside each one failed with a real Postgres
  `42501` RLS violation — the app's runtime connection never sets the
  `app.role`/`app.clinic_id` session GUCs outside of `runWithRls()`, and
  writing to `audit_logs` needs them even though the primary target
  table (`users`) doesn't. Caught by the test suite, not by types or
  lint. Fixed by wrapping each in `runWithRls(actor, ...)` instead.
- **The self-deactivation check has to run before the manage-permission
  check, not after.** `canManageTarget()` requires a non-holding-admin
  actor's target to be `FRONT_DESK`/`DOCTOR` — a Clinic Admin's own row
  is `CLINIC_ADMIN`, so that check fails first and returns a generic
  "User not found," and the `id === actor.id` guard placed after it in
  `setUserActive` was unreachable dead code for exactly the case it was
  meant to catch. Moved the self-check to the top of the function, before
  the permission-gated fetch.
- **Admin-created accounts get a random one-time temp password
  (`generateTempPassword()`), shown once on the creation success screen,
  never emailed/logged.** Built from 6 letters + 4 digits (excluding
  visually-confusing characters) so it satisfies the 10+/letter/digit
  password policy by construction rather than by chance, and
  `mustChangePassword: true` forces the existing issue #7 first-login
  flow to run before the account can do anything else.
- **A Clinic Admin can't see or reach their own row through this UI at
  all** (`listUsers` filters it out for non-holding-admins, and
  `getManagedUserById` returns null for it too) — self-service password
  changes go through `/change-password`, not this admin surface. Verified
  live: a Holding Admin's own row *is* reachable (holding admins bypass
  the clinic/role restriction), and the Deactivate button is correctly
  hidden for `isSelf` regardless.
- **Verified live against the real dev database**, not just the 23-case
  test suite: created a doctor (holding admin) and a front desk account
  (clinic admin) through the actual forms, confirmed the temp password
  triggers the forced first-login change flow end-to-end, edited a user,
  forced a password reset, deactivated/reactivated, and drove an account
  to lockout and back via "Unlock account." Along the way, found the dev
  database's `owner@familyfirst.example` password no longer matched
  `prisma/seed.ts`'s documented `FamilyFirst2026!` (left over from
  earlier manual testing this same long-running session) — re-ran
  `npx tsx prisma/seed.ts` (documented in the script itself as the
  expected way to reset dev state) rather than guess at a forgotten
  password.

## 2026-08-23 — Data retention job (issue #6, scoped to retention only)

Issue #6 bundles TLS, backups, and retention policy. Asked the owner how
to scope it before starting: TLS and backups are deployment-infrastructure
decisions with no hosting platform chosen yet in this repo (it only ever
runs via `next dev`/`next start` locally) — there's nothing real to
configure either against. Retention policy is pure application logic with
no such dependency, so that's what got built; TLS and backups stay open
on #6 until a hosting platform is chosen.

- **Preview and purge share one id-computation function
  (`computeExpiredIds` in `lib/retention/purge.ts`), not two similar
  queries.** First attempt used a `where` clause per table, duplicated
  between a count-only preview and a delete-for-real purge — caught by
  its own test: the preview undercounted queue entries and patients,
  because their eligibility *cascades* (a queue entry only becomes
  purgeable once its consultation is also expired; a patient only once
  nothing left standing references it), and the purge's sequential
  `deleteMany` calls achieve that cascade for real within one
  transaction while a static `where` clause computed against
  never-mutated data can't. Rewrote around explicit id lists computed
  once — `consultations: { none: { id: { notIn: consultationIds } } }`
  reads as "no consultation survives that isn't already in our
  to-delete set" — so preview and purge are structurally the same
  computation and can't drift apart again the same way.
- **Deletion order follows the schema's FK constraints exactly**
  (all `RESTRICT` except where noted): medicinesDispensed →
  consultations → payments → notifications → queueEntries → patients.
  Payment.consultationId is `SET NULL` (not `RESTRICT`), so a payment
  can outlive the consultation it was for — which matters here, since
  `PAYMENT_RETENTION_DAYS` (10y, bookkeeping) is deliberately longer
  than `CONSULTATION_RETENTION_DAYS` (7y, clinical) - a patient with an
  old consultation but a not-yet-expired payment correctly stays
  un-purgeable until the payment clears too, financial-recordkeeping law
  taking precedence over the shorter clinical window without any special
  case in the code for it.
- **Retention periods are defaults, not a legal opinion** — see the
  comment in `lib/retention/policy.ts`. 7 years for clinical records, 10
  for payments, 90 days for notification send-logs are commonly-cited
  minimums/ceilings, not a confirmed reading of RA 10173 (health data,
  "no longer than necessary") or BIR bookkeeping requirements for this
  specific business. Change the constants, not the purge logic, once
  those are actually confirmed.
- **Runs through the same superuser connection as `prisma/seed.ts`
  (`DATABASE_URL`), never through the app.** `prisma/grant-app-role.sql`
  deliberately grants the runtime `webinar_app` role `SELECT, INSERT,
  UPDATE` and no `DELETE` at all — §11's "nothing hard-deletes from the
  UI" decided at the RLS-migration level, not just as an app-code
  convention. This job has to run outside that boundary entirely; it
  can't be reached from any web request no matter what a bug in the app
  layer does.
- **Dry-run by default, `--execute` required to actually delete**
  (`prisma/retention.ts`) — the same caution every other hard-to-reverse
  operation in this build gets, applied at the tooling level rather than
  left to "remember not to run this carelessly."
- **Scheduling is explicitly out of scope here** — cron / a hosting
  platform's scheduled jobs / a GitHub Actions cron are all real options
  once there's an actual `DATABASE_URL` to point at, but wiring one up
  against nothing would be pure theater. Tracked in `SECURITY.md`
  alongside TLS and backups.
- **Verified live against the real dev database**, not just the test
  suite (`lib/retention/__tests__/purge.test.ts`): created a genuinely
  old, disposable notification row directly, confirmed
  `npm run db:retention`'s dry-run reported it and changed nothing, then
  ran `-- --execute` and confirmed via a direct query that the row was
  actually gone and a single `retention.purge` audit-log row was written
  with the exact counts.

## 2026-08-23 — Forced password change and login lockout (issue #7)

Two of `SECURITY.md`'s remaining "must harden" items. Built together
since both touch the same login/auth surface.

- **Sign out after a password change, rather than refreshing the live
  session.** `proxy.ts` reads `mustChangePassword` off the JWT via
  `auth.config.ts`'s Prisma-free callbacks (see the `middleware.ts` →
  `proxy.ts` entry above), which only gets re-signed on a fresh sign-in —
  not on a server action's response. Next-auth v5 has session-update
  mechanisms for this, but they're beta-surface I hadn't verified against
  this exact version, and "sign out, sign back in with the new password"
  is simple, deterministic, sidesteps the whole question, and is a
  perfectly normal UX after a password change anyway.
- **`changeOwnPassword` takes no target-user-id parameter at all** — it
  always operates on the calling `AbilitySubject`'s own id. The RLS
  policy on `users` is clinic-scoped, not self-scoped (same as every
  other clinic-wide table), so without an explicit `where: { id: user.id
  }` in the query itself, any front-desk account could overwrite a
  colleague's password in the same clinic. Structural self-scoping (no id
  argument to pass a wrong value into) beats a runtime check that could
  be gotten wrong later.
- **Password policy: 10+ characters, at least one letter and one
  number** (`lib/validation/password.ts`) — deliberately not requiring
  symbols/mixed case on top of that. The realistic bar to clear here is
  "meaningfully better than the shared dev password every seeded account
  starts with," not a corporate-IT complexity rule nobody can remember
  and everyone works around by appending "!1".
- **Lockout: 5 consecutive failures → 15 minutes**, checked *before* the
  bcrypt compare (so attempts made while already locked can't extend or
  reset the window) and *before* recording anything (so the check itself
  doesn't affect the count). The login form shows the same generic
  "Incorrect email or password" whether the cause is a wrong password or
  an active lockout — deliberately not distinguishing them, so a probing
  attempt can't learn "this account is now locked" as a side channel.
- **No per-IP throttling** — only per-account lockout. `SECURITY.md`
  explains why: a real per-IP limiter needs to survive process restarts
  and work across more than one instance, which means either new
  infrastructure (Redis, or similar) this app doesn't have yet, or an
  honest deployment-layer answer (reverse proxy / platform rate
  limiting) once real hosting is chosen — not an in-process counter that
  quietly stops working the moment there's a second instance. Same
  reasoning already applied to TLS.
- **Seeded demo accounts were *not* exempted from the forced flow.**
  `prisma/seed.ts` already sets `mustChangePassword: true` on every
  seeded user specifically so this flow would have something real to
  exercise once built (see DEMO.md's setup section, written before this
  existed). Weakening seed data to route around the feature being
  demonstrated would have been backwards; updated DEMO.md's setup
  section instead to explain what a reader will see on each account's
  first login through the script.
- **Verified live**, not just via the new test file
  (`lib/queries/__tests__/users.test.ts`,
  `lib/validation/__tests__/password.test.ts`): logged in as a seeded
  account, confirmed the `/change-password` redirect and that it can't be
  routed around, submitted a policy-violating password and got the exact
  rejection reason, changed it successfully, confirmed the forced
  sign-out and re-login with the new password landed past the gate this
  time. Separately drove 5 wrong-password attempts against a second
  account, confirmed the account locked (and that even the *correct*
  password was then rejected with the same generic message), then
  cleared the lockout fields directly and confirmed a normal login
  resumed.

## 2026-08-23 — Dependabot enabled

Follow-up to `SECURITY.md`'s "must harden" list (specifically the gap
tracked in GitHub issue #8): `npm audit` was a manual, point-in-time
check with nothing re-running it. Enabled the full Dependabot stack:

- **Repo settings** (`Settings → Code security`): dependency graph,
  Dependabot alerts, Dependabot security updates, and grouped security
  updates — all toggles, no code change, done directly rather than
  through a PR since there's no file to review.
- **`.github/dependabot.yml`** (this PR): version updates for both `npm`
  (weekly, minor/patch grouped into one PR so a routine week doesn't
  open a dozen separate ones — security-update grouping is handled
  separately by the repo-setting toggle regardless of this file) and
  `github-actions` (weekly) — the CI workflow's own `actions/checkout`/
  `actions/setup-node` pins are a separate ecosystem from `npm` and easy
  to forget.
- Dependabot's own PRs go through the same `gate` CI check and branch
  protection as any human-authored PR — no silent auto-merge of a
  dependency bump without tests passing first.

Moved the corresponding `SECURITY.md` bullet from "must harden" to
"what's actually in place" now that it's true, rather than leaving a
stale gap description next to a fixed gap.

## 2026-08-23 — `middleware.ts` → `proxy.ts` migration

Follow-up to the Next.js 16 upgrade below, which left this as a deprecated-
but-working file convention rather than doing it inline. Renamed the file
(`git mv` to preserve history) and updated every reference to it across the
codebase (`README.md`, `SECURITY.md`, `auth.config.ts`, `auth.ts`,
`lib/nav.ts`, `app/doctor/remittance/page.tsx`) — left the historical
`DECISIONS.md` entries below untouched, since they describe what was true
when they were written.

- **Kept `proxy.ts` on the Prisma-free `auth.config.ts`, did not fold it
  into the full `auth.ts`**, even though `proxy.ts` now runs on the Node.js
  runtime (fixed, not configurable — unlike the old `middleware.ts`
  convention, which always ran on Edge) and so technically *could* run
  Prisma now. The split's original forcing reason (Prisma can't run on
  Edge) is gone, but folding the two together would add a
  `prisma.user.findUnique` DB read to `proxy.ts`'s matcher — which covers
  nearly every route — on every single navigation, for a check
  (`isActive`) that already runs at the real authorization boundary: every
  query-layer call via `auth.ts`'s `auth()`. A deactivated user's stale
  JWT would still clear `proxy.ts`'s gate either way, since it only reads
  already-encoded claims; the actual block happens one layer deeper. Kept
  the split for that performance/scope reason instead, and rewrote the
  comments in `auth.config.ts`/`auth.ts`/`proxy.ts` to say so accurately
  rather than leaving the now-outdated Edge-runtime justification in place.
- **No named function to rename** — the Next.js 16 guide recommends
  renaming an exported `middleware` function to `proxy`, but this file uses
  `export default auth((req) => {...})` (Auth.js's HOC pattern around an
  anonymous handler), so there's no named export to change; the file
  rename alone satisfies the convention.
- **Re-verified live** rather than trusting the rename alone: restarted the
  dev server fresh, confirmed the "middleware file convention deprecated"
  warning is gone from `next dev`'s startup log, and re-ran the same
  cross-clinic `forbidden()` check from the upgrade entry below (real 403,
  audit-logged) plus the unauthenticated-redirect and role-section-gating
  paths — all still pass under `proxy.ts`.

## 2026-08-23 — Next.js 16.3.2 upgrade

Follow-up to the `npm audit fix` pass: 3 high-severity findings (`postcss`,
`sharp`) were left unresolved because both are bundled inside `next`
itself, and Next's own declared ranges (`postcss` exact-pinned, `sharp`
capped under `^0.34.3`) excluded the patched releases. Confirmed via
`npm view next@16.3.2 dependencies/optionalDependencies` that `16.3.2`
bundles the patched versions (`postcss@8.5.23`, `sharp@^0.35.3`) before
touching anything.

- **Read the actual v16 upgrade guide before changing code**, per
  AGENTS.md's standing instruction that this Next.js version has
  training-data-breaking changes. Checked every breaking change in it
  against real usage (grep, not assumption) rather than assuming any of
  them applied: no `next/image` usage anywhere in the app, no
  `opengraph-image`/`icon`/`sitemap` generators, no parallel-route slots,
  no `unstable_rootParams`/`cacheLife`/`cacheTag`/`revalidateTag`, no
  `serverRuntimeConfig`/`publicRuntimeConfig`, no custom webpack config,
  already on ESLint Flat Config and already running `eslint` directly
  (not the now-removed `next lint`), and Request APIs (`cookies`/
  `headers`/`params`/`searchParams`) were already fully async from the
  M7 typegen work — so none of v16's breaking changes actually touched
  this codebase.
- **`middleware.ts` → `proxy.ts` is deprecated, not removed**, in 16.3.2 —
  left `middleware.ts` as-is rather than renaming, since the app still
  works and `proxy.ts` running on the `nodejs` runtime (not Edge, and not
  configurable) is an unrelated, separate decision — it would lift the
  exact Edge-runtime constraint that forced the `auth.config.ts`/`auth.ts`
  split (see the M1 entry below), but that's a future cleanup, not part of
  this upgrade.
- **`experimental.authInterrupts` and `forbidden()`/`unauthorized()` are
  unaffected** — not mentioned anywhere in the v16 removals list. Verified
  live rather than trusting that: logged in as a front-desk user from one
  clinic, requested another clinic's patient by direct id, got a real
  `GET /staff/patients/[id] 403` (confirmed via network inspection, not
  just the rendered page text) and a `patient.read.denied` row in
  `audit_logs` with the correct `attemptedClinicId` — the exact same check
  the M1 entry below describes, re-run against the new Next.js version.
  Also re-verified the unauthenticated-redirect and role-section-gating
  paths in `middleware.ts` (signed-out → `/login`, wrong-role → the
  role's home page) against a fresh dev server.
- **`next typegen` mandatorily changed `tsconfig.json`'s `jsx` from
  `"preserve"` to `"react-jsx"`** (Next 16 requires the automatic JSX
  runtime) — accepted as-is, not worked around; it's a framework
  requirement, not a project choice to preserve.
- **Package versions**: `next` bumped `15.5.23` → `16.3.2` (kept the
  repo's exact-pin convention, matching `prisma`), `eslint-config-next`
  `^16.3.1` → `^16.3.2`. `react`/`react-dom` stayed at `19.2.8` — already
  the latest React release, no bump needed. `npm audit` now reports 0
  vulnerabilities.
- **A stale `next dev` process from before the upgrade produced misleading
  errors** (`ENOENT ... action-utils.js`, 500s) when reused instead of
  restarted — Next 16 changed the dev output directory (`.next/dev`), so
  an old process still pointed at paths that no longer existed after the
  package bump. Not a real regression; resolved by stopping the stale
  server and clearing `.next` before restarting. Worth remembering for any
  future upgrade: always restart `next dev` fresh, don't reuse a running
  instance across a `next` version bump.

## 2026-08-23 — M7: polish

Mobile pass across every authenticated shell and the public booking page,
empty/error-state audit, `DEMO.md`, and this file's own entry.

Verified live at a 375px viewport (§9's explicit "must work one-handed"
bar for the consultation screen and queue board): a hamburger-triggered
nav replacing three separate bespoke headers, the reports page's tables
and stat grid, the consultation screen's vitals row, the queue board's
per-row action buttons, and the public booking form all render without
truncation, overflow, or unreachable controls. 56/56 tests still pass; no
behavior changed in any of the fixes below, only layout and — in two
cases — a real correctness bug the mobile pass happened to surface.

- **Found and fixed the same bug twice, independently, in two different
  forms**: the walk-in registration form (`/staff/register`) and the
  public booking form (`/book/[slug]`) both used React 19's
  `<form action={handleSubmit}>` pattern with uncontrolled inputs, where
  `handleSubmit` catches its own error and returns `{ok: false, error}`
  rather than throwing. React resets every uncontrolled field once an
  `action` promise *resolves* — regardless of whether the resolved value
  represents success or a caught application error — so a single mistyped
  field (e.g. too-short emergency contact number) wiped the entire form
  and forced a full retype. Converted both to controlled React state;
  verified live on the booking form specifically, since it's the
  higher-stakes case — a public patient typing their own information on
  their own phone, not trained staff. Every other form in the app using
  the same `<form action={...}>` shape (login, consultation, receive
  stock, physical count) either doesn't catch its own errors internally
  or doesn't have enough fields for a lost-form retype to be a real
  burden, so those weren't touched.
- **A shared `AppHeader` (`components/nav/app-header.tsx`) replaces three
  separate bespoke headers** (staff, doctor, console — the last of which
  was a permanent `w-56` sidebar consuming ~60% of a 375px screen) — the
  staff nav alone has 7 destinations, which silently overflowed and hid
  the last few links with no way to reach them below `sm`. Below `sm`,
  all three shells now show a hamburger-triggered dropdown instead of
  trying to fit a full link row.
- **Both mobile-pass grid fixes follow the same shape**: a fixed
  `grid-cols-N` that fit comfortably on desktop but squeezed every child
  below a usable width at 375px (the reports page's 3-column revenue/
  diagnoses/medicines section, truncating "Dr. Quezon City 1" to "D...";
  the consultation screen's 5-column vitals row, truncating "Weight" to
  "Wei"). Fixed by adding a responsive breakpoint (`grid-cols-1
  sm:grid-cols-3`, `grid-cols-2 sm:grid-cols-5`) rather than redesigning
  the desktop layout, since desktop was never broken.
- **The queue board's "Called" row needed `flex-wrap` one level deeper
  than the reports/vitals grids did.** Its action-button group (assign-
  doctor select + Recall + No-show + Start consultation, ~460px of
  `whitespace-nowrap` shadcn buttons) sat inside a `flex items-center
  gap-2` div with no `flex-wrap` of its own — the *outer* row already had
  `flex-wrap`, but that only lets the row break between the patient-info
  block and the action-button group as a whole, not within the group.
  Fixed by adding `flex-wrap` to that inner div too; the "Waiting" row's
  equivalent group happened to fit in ~300px so never visibly broke, but
  would have the same latent issue at a narrower viewport or a longer
  doctor name in the select.
- **Data tables (reports page's clinic table, inventory table) get their
  own `overflow-x-auto` wrapper with a `min-w` on the table** rather than
  cramming columns to fit — scrolling a data table horizontally on
  mobile is a normal, expected pattern; shrinking six columns of numbers
  to illegibility is not.
- **Added `app/error.tsx` and `app/not-found.tsx`** — the app already had
  `app/forbidden.tsx` for the explicit 403 case (M1) but nothing for an
  uncaught render error or a bad URL, both of which fell through to
  Next's default (blank/generic in production). Audited the rest of the
  app's list screens for missing empty states while at it — all 16
  found already had one from earlier milestones (`Panel`'s "All clear.",
  the queue board's "Nobody waiting.", etc.); no gaps.
- **The public display screen and the patient's own `/q/<token>` status
  page were both left alone.** The display screen is a room-scale TV/
  monitor view with huge fixed-size digits — not a phone screen, out of
  the mobile pass's actual scope despite being public-facing. The status
  page was already a single-column, `min-h-screen`, mobile-first card
  from when M3 built it; nothing to fix.
- **This session's browser-automation tooling was unreliable for most of
  M7's live verification** — `computer` click/keyboard actions frequently
  timed out regardless of viewport, tab, or retry count, while the
  underlying app never errored (confirmed via console/network
  inspection). Worked around it with `form_input` for filling fields
  (a different delivery path that kept working) and, purely to observe
  results after a genuine timeout, dispatching a click on an
  already-implemented button via `javascript_tool` — never to implement
  anything; every fix in this entry is a source diff, verified visually
  and via `document.documentElement.scrollWidth`/state inspection
  afterward, not "typed into the debug console and called done."

## 2026-08-22 — M6: reporting and reconciliation

Clinic reports (visits, new-vs-returning, revenue total and by doctor,
average wait/consultation duration, no-show rate, top diagnoses, top
medicines, expenses, net, a revenue-over-time bar chart), the inventory
report (stock valuation at cost, per-medicine received/dispensed/
adjusted/returned reconciliation over a date range), the holding
consolidated report (all clinics side by side, combined P&L, ranking by
revenue and volume), CSV export for all three, and cash reconciliation
(`/staff/remittance` + a matching `/doctor/remittance`, since doctors are
collectors too).

Verified live end-to-end: the holding admin's consolidated report showed
all three clinics with Quezon City's real ₱1,132.00 in revenue, and a
direct Postgres query (`SUM(payments.amount) GROUP BY clinic`) confirmed
that figure was exactly the sum of that clinic's payment rows for the
range — §12's accept line checked directly against the database, not just
asserted by the app. Recorded a ₱15,000.00 expense and watched the clinic
report's net figure update to match (₱1,132.00 − ₱15,000.00 —
deliberately large to make the arithmetic obvious). Submitted a
remittance as a doctor with a ₱20.00 shortfall, watched the variance
display correctly on both the doctor's own screen and the clinic admin's
pending-confirmation queue complete with the doctor's notes, and
confirmed it. CSV export verified via direct `fetch()` against the route
handlers, returning correctly-shaped rows. 56/56 tests pass (8 new in
`lib/queries/reports/__tests__/reports.test.ts`).

- **Doctors get their own `/doctor/remittance`, reusing the exact same
  form component as `/staff/remittance`** rather than one shared route.
  §7.7's screen is literally named `/staff/remittance` and §1 says
  "today doctors take cash directly" — a doctor is as much a "collector"
  under §7.7 as front desk is, but middleware's `/staff/*` gate is
  reserved for front-desk/admin screens, and punching a doctor-shaped
  hole in that gate felt like the wrong fix for a role-boundary that
  exists on purpose. The underlying query functions
  (`getMyRemittanceStatus`/`submitRemittance`) already took any
  clinic-scoped `AbilitySubject` with no role check — only
  `listPendingRemittances`/`confirmRemittance` are clinic-admin-gated,
  correctly.
- **`expectedAmount` is never a parameter `submitRemittance` accepts** —
  it's always computed server-side from real `Payment` rows for that
  collector's day, the same number `/doctor/collections` (M4) already
  shows. There's no code path where a collector's own claimed "expected"
  figure could reach the database; §7.7's whole point ("digitizing
  payments just moves an unverified number into a database" otherwise)
  would be defeated by trusting the client for the one number the
  variance is measured against.
- **New vs. returning patients is defined by *first checked-in visit ever
  at this clinic*, computed by checking whether each in-range patient has
  any checked-in visit before the range start** — not by `Patient.createdAt`
  (a patient can be registered without a same-day visit, e.g. imported or
  pre-registered) and not by a stored "first visit" flag (would need
  updating exactly once per patient, an easy invariant to accidentally
  break later). Costs one extra query per report (fetch prior visits for
  the range's distinct patient IDs) in exchange for never being able to
  drift from the actual visit history.
- **No-show rate's denominator is only patients who actually
  checked in** (`checkedInAt` in range), not every `QueueEntry` touched in
  the range. A `BOOKED` entry that's simply still upcoming, or was
  `CANCELLED` before ever arriving, was never "expected to show up and
  didn't" the way a no-show specifically is — `markNoShow` itself only
  accepts `CHECKED_IN`/`WAITING`/`CALLED` entries (§7.3, unchanged from
  M3), so every `NO_SHOW` row already necessarily has `checkedInAt` set;
  the report's population just mirrors that same rule.
- **Every report resolves its own real UTC instant range per clinic
  timezone** (`resolveReportInstantRange`, reusing the `fromZonedTime`
  pattern from M4's `todayInstantRange`) rather than accepting raw
  start/end `Date` objects from the query string directly. The holding
  report resolves this *once per clinic* inside its loop, not once
  globally, since nothing here assumes every clinic shares a timezone
  even though all three seeded ones currently do.
- **CSV export is one flat "metric,value" table per clinic/holding report,
  not a literal dump of every underlying row** — the report's own summary
  numbers (visits, revenue, doctor breakdown, top diagnoses/medicines) are
  what a clinic admin actually asked for in §8's "every report has ...
  CSV export," and building a separate multi-table export format for
  something CSV isn't naturally shaped for felt like solving a problem
  nobody described. The inventory report's CSV is the one exception —
  its `rows` (one row per medicine) were already naturally tabular, so
  that export is the row data directly, not a summary of it.
- **Chose recharts' `BarChart` over `LineChart`** for "revenue over time"
  — daily revenue is a small number of discrete buckets (days), and a bar
  better represents "this much money on this day" than a line implying
  interpolation between days that didn't necessarily have any activity.
  Recharts was already a dependency (inherited from the prior project's
  scaffold) — matches §8's "do not build a charting framework" instruction
  by construction, not by restraint.
- **Recharts 3.10.1's `Tooltip` `formatter` prop types `value` as
  possibly `undefined` and not necessarily a plain `number`** (a
  `ValueType | undefined` union), which broke a first draft written
  against the simpler signature training data assumes for recharts v2.
  Caught immediately by `tsc`, not at runtime — fixed by reading the
  installed package's own `.d.ts` rather than guessing, the same
  "check the installed version, don't assume" discipline AGENTS.md's
  warning about this Next.js version already established for other
  breaking-change surprises this build has hit.

## 2026-08-22 — M5: notifications

`NotificationChannel` interface with `MockChannel` (default, logs to
console + the `notifications` table), stubbed `SmsChannel`/
`MessengerChannel` that throw a clear error instead of silently no-op'ing
if switched on before a real integration exists, and all five templates
in one file (`lib/notifications/templates.ts`). Wired into the three
event-triggered sends (booking confirmed, number called, no-show) plus
the position-based "almost your turn" recompute, the follow-up list's
one-tap send (§9 staff screen), and the notification log viewer.

Verified live: booked a patient online and found the fully-rendered SMS
text (queue number, real `/q/{token}` link, clinic address) both in the
mock channel's console log and on `/staff/notifications`; checked her in
and called her, and watched a second, correctly-worded `now_serving`
notification appear; marked a different patient a no-show and confirmed
a third notification with their own name and the clinic's phone number.
`almost_your_turn`'s "notify once, only for patients newly within range"
logic is covered by test rather than manual clicking through a 5-deep
queue — verified there that calling `Call Next` a second time adds zero
new notifications when nobody new entered the window. 48/48 tests pass
(6 new in `lib/queries/__tests__/notifications.test.ts`).

- **A second real "Dr. Dr." double-prefix bug, caught by a test failure
  before it ever reached the browser this time.** The `follow_up_due`
  template hardcoded "with Dr. {doctorName}," but seeded (and any
  real-world) doctor display names already carry the title — the exact
  class of bug M4 found and fixed in two UI display spots. Fixed the
  template instead of the data this time (same tradeoff reasoning as
  M4: fixing the template takes effect immediately, without a reseed);
  worth someone eventually deciding once whether `User.name` should ever
  store a title at all, rather than re-discovering this a third time.
- **"~3 patients ahead" is a recomputed condition, not a single event** —
  §7.6 lists it as a trigger point, but nothing in the app *causes* a
  patient to become "3rd in line" the way calling someone or marking a
  no-show is a discrete action. Implemented as a helper
  (`notifyAlmostYourTurn` in `lib/queries/queue.ts`) that re-scans the
  active queue and fires for anyone newly in the top few places, called
  after every action that can change other patients' effective position:
  `callNextEntry`, `markNoShow`, and `moveQueueEntryOrder`. A
  `notifications` existence check (by `queueEntryId` + `templateKey`)
  before each send is what makes "recompute after every change" safe
  rather than spammy — same patient never gets it twice.
- **Position 0 of the *remaining* active queue (after the just-called
  entry is removed) doesn't get `almost_your_turn`.** That's the patient
  who is now next in line — they're about to receive `now_serving`
  directly on the next call, so a separate "almost your turn" heads-up
  immediately before it would be redundant. Written as `active.slice(1,
  4)` on the recomputed pool; caught the exact off-by-one this produces
  (skips the newly-next patient, not literally "3 ahead" from the
  pre-call pool) via a failing test assertion, not by reasoning it
  through in advance — fixed the test's expectation to match the correct
  behavior rather than the behavior to match a hastily-written
  expectation, after actually working out which one was right.
- **§7.6's literal "please proceed to Room X" became "please proceed to
  the clinic"** — there's no room/counter field anywhere in §6's schema,
  and this build hasn't added one (no evidence the real clinic assigns
  numbered rooms). Fabricating a room number would be worse than omitting
  it; revisit if the owner confirms clinics do have numbered rooms/
  counters worth tracking.
- **The follow-up "one-tap send" can be sent more than once per
  consultation** — the list shows "Send reminder" vs. "Send again" based
  on whether a `follow_up_due` notification already exists for that
  queue entry, but never disables the button. A patient who didn't show
  up for a first reminder plausibly needs a second nudge; there's no
  spec language suggesting a hard one-time limit the way `almost_your_turn`
  needed one (that one exists purely to avoid re-notifying on every
  queue-position recompute, a mechanical concern with no analogue here).
- **Sending happens inside the same DB transaction as the triggering
  write** (booking, call-next, no-show, follow-up send) — fine for
  `MockChannel`, which is synchronous and local, but worth flagging now:
  a real network-calling channel (Semaphore, Messenger) held open inside
  a Postgres transaction is a real latency/lock-duration problem. When a
  live channel actually gets wired up, sending should move outside the
  transaction (e.g. queue the notification row first, dispatch after
  commit) rather than reuse this exact shape unchanged.

## 2026-08-22 — M4b: inventory

Full medicine catalog management (add/edit/deactivate, clinic admin only),
receive stock, the physical count workflow, the movement ledger view,
low-stock/expiring/expired filters and dashboard panels, and the two
pieces M4 deliberately deferred: the insufficient-stock override
("dispense anyway") and corrections (deleting a dispensed row via a
compensating `return` movement, never an edit).

Verified live end-to-end as clinic admin + doctor: received 50 units of
Amoxicillin (120 → 170); ran a physical count that found Mefenamic Acid
at 25 instead of the system's 30, submitted with a reason, and got back
"1 discrepancy, total variance ₱-10.00" with a matching `ADJUSTMENT`
movement; edited Mefenamic Acid's reorder level without touching its
stock; corrected Maria Santos's earlier Paracetamol dispense from her
patient profile, watched it disappear from her visible history and stock
return from 196 to 200 via a `RETURN` movement while the original
`DISPENSE` movement stayed exactly as it was; then, as a doctor,
attempted to dispense 30 Mefenamic Acid against a stock of 25, got
blocked with "25 available, 30 requested," checked "dispense anyway,"
resubmitted, and confirmed stock went to **-5** with an audit log entry
naming the doctor. 42/42 tests pass (9 new in
`lib/queries/__tests__/inventory.test.ts`, on top of M4's 6).

- **The override "drives stock to the true figure" by dispensing the
  *full requested amount*, allowing `current_stock` to go negative** —
  not by capping the dispense at whatever the system thought was
  available. Re-read §7.5's phrase a few times before committing to this:
  the alternative (silently dispensing only what the system shows as
  available) would misrepresent what the doctor actually handed the
  patient, and negative stock is itself a legible signal to run a
  physical count rather than a value to hide. The audit log entry named
  the doctor (verified directly in Postgres, not just asserted in a
  test) is what makes this a supervised exception rather than a quiet
  bypass.
- **Corrections (deleting a dispensed row) are clinic-admin-only**, not
  available to the prescribing doctor. §7.5 doesn't say who may do this;
  scoped it to the oversight role rather than letting a doctor
  unilaterally undo their own already-saved clinical/financial record,
  consistent with the read-only "Correct" action living on the patient
  profile page (where clinic admins already review history) rather than
  inside the doctor's own consultation flow.
- **The physical count's "required reason" is one reason per submission,
  applied to every discrepancy movement it creates**, not a separate
  reason per medicine. §7.5 says "writes one adjustment movement per
  discrepancy with a required reason" — satisfied literally (every
  adjustment movement does carry a reason), and a single free-text reason
  per count event ("Monthly count," "Post-delivery recount") is how a
  real physical count actually happens: one session, one cause, many
  line items. A medicine left blank in the count form is treated as "not
  counted this time" and produces no movement at all, rather than being
  read as "counted as zero."
- **Receiving stock updates `unitCost` unconditionally on every receipt**
  (this delivery's cost becomes the medicine's stored cost), but only
  updates `expiryDate` when the receiving staff explicitly checks "this
  delivery's expiry is later" — matching §7.5's DECISION that this is a
  human call, not an automatic max() comparison, since §7.5 also commits
  to no batch/lot tracking (one stock number, one expiry date, so
  whichever delivery should "win" the stored expiry has to be a real
  choice, not a formula).
- **A new catalog medicine starts at 0 stock; only `receiveStock` (or a
  physical count) ever changes `current_stock`** — `createMedicine` never
  takes an initial-quantity field, even though that'd save a step for the
  common case of adding a medicine and immediately stocking it. Keeping
  "catalog exists" and "stock arrived" as two separate, separately
  audited events (via two different screens, `/staff/inventory/new` then
  `/staff/inventory/receive`) was worth the extra click to preserve —
  every unit of stock traces to a real receipt movement with no
  exception, which is exactly the invariant M4b's own accept line tests
  for.

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
