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
holding admin, plus a clinic admin/2 front desk/3 doctors per clinic) are
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

## Authentication & authorization

Auth.js (Credentials provider) with JWT sessions — no separate session
store. Config is split across two files because middleware runs on
Next.js's Edge runtime, where Prisma Client can't run without Accelerate or
Driver Adapters:

- `auth.config.ts` — edge-safe base config (session strategy, login page,
  the `session` callback that copies role/clinic fields from the token onto
  `session.user`). No providers, no Prisma. Shared by both files below.
- `auth.ts` — the full Node.js-runtime config: the Credentials provider
  (bcrypt password check) and a `jwt` callback that re-checks `isActive` on
  every request, so deactivating a user takes effect on their next
  navigation rather than only at their next login.
- `middleware.ts` — route gating, built on `auth.config.ts` only. Redirects
  signed-out requests to `/login`, and redirects a signed-in user's role to
  its home page if it doesn't match the section (`/staff`, `/doctor`,
  `/console`) it's not allowed into. Public prefixes (`/book/`, `/q/`,
  `/display/`, `/login`, `/api/auth`) skip this entirely — patients never
  authenticate (§4).

Middleware role checks are a coarse first gate, not the authorization
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
  accounts, and a couple of demo patients per clinic (idempotent — safe to
  rerun)
