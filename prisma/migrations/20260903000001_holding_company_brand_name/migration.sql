-- The product name shown to patients and staff (browser tab, login card,
-- header, booking page), kept apart from holding_companies.name — that one
-- is the legal entity and is displayed as such on the admin overview.
--
-- Nullable with no default: NULL means "not set", which the app reads as
-- DEFAULT_APP_NAME (lib/branding.ts). Backfilling every row with the
-- current hardcoded string instead would make a deployment's built-in
-- default impossible to return to once changed.
ALTER TABLE "holding_companies" ADD COLUMN "brand_name" TEXT;
