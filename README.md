# Stretch Lab PH

Internal clinic console + public booking site for Stretch Lab PH. Next.js 15
(App Router) + TypeScript, Prisma/PostgreSQL, Auth.js, Tailwind + shadcn/ui.
See `DECISIONS.md` for build-order progress and the assumptions made along
the way.

## Getting started

```bash
npm install
npx prisma migrate dev
npm run db:seed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Seeded staff logins
(one per role) are printed by `npm run db:seed`.

Copy `.env.example` to `.env` (Prisma reads `DATABASE_URL` from here) and
`.env.local` (everything else) before running migrations.

## Scripts

- `npm run dev` — start the dev server
- `npm run build` / `npm run start` — production build/serve
- `npm run lint` — ESLint
- `npm run test` — Vitest (`lib/quota` and `lib/permissions` are the
  non-negotiable suites per the product spec)
- `npm run db:seed` — reseed branches + one staff account per role
