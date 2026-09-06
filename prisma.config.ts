import { defineConfig, env } from "prisma/config"

// Prisma 7 no longer loads .env files itself. Same two files, same order,
// same tolerance for absence as lib/db/env-files.ts — inlined rather than
// imported, so the CLI's config loader never has to resolve project code.
// In CI and on Vercel the variables arrive as real environment variables.
for (const file of [".env", ".env.local"]) {
  try {
    process.loadEnvFile(file)
  } catch {
    // Absent is normal outside a developer machine.
  }
}

/**
 * Where Prisma Migrate connects — DATABASE_URL, the superuser/direct
 * connection — used to live in the schema's datasource block; Prisma 7 moved
 * it here. The *app* never reads this: it connects through
 * lib/db/client-factory.ts with APP_DATABASE_URL, the non-superuser role
 * that makes Row Level Security apply (see lib/db/prisma.ts).
 *
 * `env()` throws if the variable is missing, so a `prisma generate` or
 * `migrate deploy` without it fails with the variable's name rather than a
 * connection error to nowhere.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // Was package.json#prisma.seed. Prisma 7 never seeds on its own —
    // `npm run db:seed` (or `prisma db seed`) is the explicit step.
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
})
