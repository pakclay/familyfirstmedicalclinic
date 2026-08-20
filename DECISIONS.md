# DECISIONS.md

Running log of assumptions made where the spec was silent or where the
environment forced a deviation. Dated, so the owner can correct any of
these. Newest first.

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
