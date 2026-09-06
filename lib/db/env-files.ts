/**
 * Loads .env and .env.local into process.env, in that order, and doesn't
 * mind if either is missing — in CI and on Vercel the variables arrive as
 * real environment variables and there is no file on disk.
 *
 * Needed since Prisma 7, which stopped loading .env files itself: the
 * scripts under prisma/ and the vitest setup call this before anything
 * reads DATABASE_URL. prisma.config.ts inlines the same loop rather than
 * import project code into the Prisma CLI's config loader.
 */
export function loadEnvFiles(): void {
  for (const file of [".env", ".env.local"]) {
    try {
      process.loadEnvFile(file)
    } catch {
      // Absent is normal outside a developer machine.
    }
  }
}

/** DATABASE_URL, for the scripts and tests that cannot do anything without it. */
export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is not set — nothing to connect to.")
  return url
}
