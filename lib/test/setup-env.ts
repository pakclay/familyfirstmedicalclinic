// Vitest doesn't load .env files the way Next.js's dev/build process does —
// load them explicitly so DATABASE_URL/APP_DATABASE_URL are populated
// before any test module constructs a PrismaClient.
try {
  process.loadEnvFile(".env")
} catch {
  // fine in environments where .env doesn't exist (e.g. CI with real env vars set)
}
try {
  process.loadEnvFile(".env.local")
} catch {
  // optional
}
