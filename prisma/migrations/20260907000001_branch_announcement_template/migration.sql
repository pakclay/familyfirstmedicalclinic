-- What the calling board (app/now-serving) says aloud when a patient is
-- called, per branch, with {number} and {name} placeholders — see
-- lib/utils/announcement.ts.
--
-- Nullable with no default: NULL means "not set", which the app reads as
-- DEFAULT_ANNOUNCEMENT_TEMPLATE. Same reasoning as holding_companies
-- .brand_name — backfilling today's wording into every row would make
-- the built-in default impossible to return to once it changed.
ALTER TABLE "branches" ADD COLUMN "announcement_template" TEXT;
