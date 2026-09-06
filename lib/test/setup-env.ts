// Vitest doesn't load .env files the way Next.js's dev/build process does —
// load them explicitly so DATABASE_URL/APP_DATABASE_URL are populated
// before any test module constructs a PrismaClient.
import { loadEnvFiles } from "@/lib/db/env-files"

loadEnvFiles()
