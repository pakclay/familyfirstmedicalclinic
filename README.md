# Family First Medical Clinic

Clinic console + public booking/queue site, replacing the notebook and the
index-card cabinet with a paperless MVP. Next.js 15 (App Router) + TypeScript,
Prisma/PostgreSQL, Auth.js, Tailwind + shadcn/ui. See `SPEC.md` for the full
product spec and `DECISIONS.md` for build-order progress and the assumptions
made along the way.

This repo previously held a different product (Stretch Lab PH); that work is
preserved in git history but is unrelated to what's here now.

## Getting started

```bash
npm install
npx prisma migrate dev
npm run db:seed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Seeded logins (one
holding admin, plus a clinic admin/2 front desk/3 doctors per clinic) are
printed by `npm run db:seed`, all sharing one dev password.

Copy `.env.example` to `.env` (Prisma reads `DATABASE_URL` from here) and
`.env.local` (everything else) before running migrations.

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
