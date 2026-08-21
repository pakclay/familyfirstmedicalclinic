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
