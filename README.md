# Family First Medical Clinic

Clinic console + public booking/queue site, replacing the notebook and the
index-card cabinet with a paperless MVP. Next.js 16 (App Router) + TypeScript,
Prisma/PostgreSQL, Auth.js, Tailwind + shadcn/ui. See `SPEC.md` for the full
product spec and `DECISIONS.md` for build-order progress and the assumptions
made along the way.

This repo previously held a different product (Stretch Lab PH); that work is
preserved in git history but is unrelated to what's here now.

## Getting started

```bash
npm install
npx prisma migrate dev
APP_DB_PASSWORD='<match APP_DATABASE_URL below>' psql "$DATABASE_URL" -f prisma/grant-app-role.sql
npm run db:seed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Seeded logins (one
holding admin, plus a branch admin/2 front desk/3 doctors per clinic) are
printed by `npm run db:seed`, all sharing one dev password.

Copy `.env.example` to `.env` (Prisma reads `DATABASE_URL` from here) and
`.env.local` (everything else) before running migrations. `APP_DATABASE_URL`
names a non-superuser Postgres role (`webinar_app`) that doesn't exist on a
fresh Postgres install — the `prisma/grant-app-role.sql` step above creates
it (or updates its password if it already exists) and grants it the table
access the app needs; RLS depends on connecting as this role rather than a
superuser (see "Authentication & authorization" below), so skipping this
step doesn't break the app, it just silently stops enforcing clinic
scoping at the database layer. Re-run it any time after
`prisma migrate reset`, which recreates the schema from scratch and drops
these grants with it.

In production (Supabase, Vercel) the two URLs point at two different
things on purpose: `DATABASE_URL` at the direct or session-mode connection,
because Prisma Migrate needs one, and `APP_DATABASE_URL` at the pooler in
**transaction mode** — port 6543, with `?connection_limit=5` (since Prisma 7
the app talks to Postgres through node-postgres — `lib/db/client-factory.ts`
turns `connection_limit` into the pool size, and the old `pgbouncer=true`
flag no longer does anything).
Session mode (port 5432) caps clients at the pooler's `pool_size`, and a
few warm serverless instances exhaust that; the app then fails mid-request
with `EMAXCONNSESSION`. `lib/db/prisma.ts` logs an error at startup if it
sees the wrong shape, and explains why transaction mode is safe for the RLS
scoping here.

## Authentication & authorization

Auth.js (Credentials provider) with JWT sessions — no separate session
store. Config is split across two files: `proxy.ts` deliberately runs only
Prisma-free logic, so its route gating stays a cheap check against
already-encoded JWT claims rather than a DB read on every navigation:

- `auth.config.ts` — Prisma-free base config (session strategy, login page,
  the `session` callback that copies role/clinic fields from the token onto
  `session.user`). No providers, no Prisma. Shared by both files below.
- `auth.ts` — the full Node.js-runtime config: the Credentials provider
  (bcrypt password check) and a `jwt` callback that re-checks `isActive` on
  every request, so deactivating a user takes effect on their next
  navigation rather than only at their next login.
- `proxy.ts` — route gating, built on `auth.config.ts` only. Redirects
  signed-out requests to `/login`, and redirects a signed-in user's role to
  its home page if it doesn't match the section (`/staff`, `/doctor`,
  `/console`) it's not allowed into — the one exception being
  `/staff/inventory`, the medicine pages, which a doctor may also enter.
  Public prefixes (`/book/`, `/q/`,
  `/display/`, `/login`, `/api/auth`) skip this entirely — patients never
  authenticate (§4). Named `proxy.ts` per the Next.js 16 convention (the
  older `middleware.ts` name still works but is deprecated); unlike the old
  middleware convention, `proxy.ts` runs on the Node.js runtime rather than
  Edge, though this codebase doesn't rely on that for anything yet.

Proxy role checks are a coarse first gate, not the authorization
boundary itself: every query-layer function additionally takes an
`AbilitySubject` (`lib/permissions/ability.ts`) and is scoped to that user's
clinic, backstopped by Postgres RLS (`lib/db/rls.ts`) so a bug in the app
layer can't leak another clinic's rows. A forbidden read throws
`ForbiddenError` (`lib/permissions/errors.ts`) rather than silently
returning an empty list.

## Continuous integration

`.github/workflows/ci.yml` runs on every push/PR to `master`: spins up a
disposable Postgres 17 service container, applies migrations, runs
`prisma/grant-app-role.sql` against it (a fixed, clearly-fake password —
the container and its data don't outlive the job), then `tsc --noEmit`,
`eslint .`, and `vitest run`. The test suite talks to that real database
rather than a mock — RLS and the superuser/`webinar_app` connection split
it depends on can't be verified against anything less — but every test
creates and tears down its own fixtures, so it never needs `npm run
db:seed` first.

## Scripts

- `npm run dev` — start the dev server
- `npm run build` / `npm run start` — production build/serve
- `npm run lint` — ESLint
- `npm run test` — Vitest — `lib/queries/__tests__/patients.test.ts` proves
  the clinic-scoping bar from §12/M1: a cross-clinic read 403s and is
  audit-logged, both at the app layer and independently via the Postgres RLS
  backstop
- `npm run db:seed` — reseed the holding company, clinics, staff/doctor
  accounts, the medicine catalog, and a couple of demo patients per clinic.
  **Destructive**: it deletes every patient, payment, consultation, user and
  branch first and rebuilds them, so it is for a development database only —
  never point it at a clinic that is in use.
- `npm run db:seed-medicines` — adds the starter medicine catalog
  (`prisma/medicine-catalog.ts`, ~38 items) to any branch missing it. The
  safe counterpart to the above: it only ever inserts, never deletes and
  never edits an existing medicine, so it can be run against a live
  deployment. Dry run by default, like `db:retention`:
  - `npm run db:seed-medicines` — report what would be added
  - `npm run db:seed-medicines -- --execute` — add the catalog at zero stock
  - `... -- --execute --with-opening-stock` — also book opening quantities
    (demo/staging only; a real clinic receives its own stock)
  - `... -- --execute --branch=cebu-city` — one branch
- `npm run db:retention` — reports what's past its retention window
  (`lib/retention/policy.ts`) without deleting anything; add `-- --execute`
  to actually purge. Connects via `DATABASE_URL` (the migration/superuser
  role) since this needs `DELETE`, which the app's runtime
  `APP_DATABASE_URL` role deliberately doesn't have. Not yet wired to run
  on a schedule — see `SECURITY.md`.
