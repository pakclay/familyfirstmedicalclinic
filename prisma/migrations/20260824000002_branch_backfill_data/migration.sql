-- Step 2 of 6: data backfill (DML only, no schema change).
--
-- Creates exactly one default Branch per existing Clinic, copying that
-- clinic's current slug/name/address/hours/etc. verbatim — this is what
-- keeps existing public links (/book/{slug}, /display/{slug}) resolving
-- unchanged after the migration, since the branch inherits the exact slug
-- string that used to live on the clinic. Data-driven, not hardcoded to
-- any specific known clinic — runs identically against dev and prod.
INSERT INTO "branches" (
  "id", "clinic_id", "name", "slug", "address", "city", "phone",
  "facebook_page_url", "timezone", "operating_hours", "is_active",
  "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text, "id", "name", "slug", "address", "city", "phone",
  "facebook_page_url", "timezone", "operating_hours", "is_active",
  "created_at", "updated_at"
FROM "clinics";

-- Point every dependent row at the branch just created for its clinic.
-- Rows whose clinic_id is NULL (holding admins in "users", clinic-less
-- system rows in "audit_logs") simply never match and branch_id stays
-- NULL — correct, no special-casing needed since both columns stay
-- nullable on those two tables (see the next migration).
UPDATE "users" u SET "branch_id" = b."id" FROM "branches" b WHERE b."clinic_id" = u."clinic_id";
UPDATE "doctors" t SET "branch_id" = b."id" FROM "branches" b WHERE b."clinic_id" = t."clinic_id";
UPDATE "patients" t SET "branch_id" = b."id" FROM "branches" b WHERE b."clinic_id" = t."clinic_id";
UPDATE "queue_entries" t SET "branch_id" = b."id" FROM "branches" b WHERE b."clinic_id" = t."clinic_id";
UPDATE "consultations" t SET "branch_id" = b."id" FROM "branches" b WHERE b."clinic_id" = t."clinic_id";
UPDATE "medicines" t SET "branch_id" = b."id" FROM "branches" b WHERE b."clinic_id" = t."clinic_id";
UPDATE "stock_movements" t SET "branch_id" = b."id" FROM "branches" b WHERE b."clinic_id" = t."clinic_id";
UPDATE "medicines_dispensed" t SET "branch_id" = b."id" FROM "branches" b WHERE b."clinic_id" = t."clinic_id";
UPDATE "payments" t SET "branch_id" = b."id" FROM "branches" b WHERE b."clinic_id" = t."clinic_id";
UPDATE "remittances" t SET "branch_id" = b."id" FROM "branches" b WHERE b."clinic_id" = t."clinic_id";
UPDATE "expenses" t SET "branch_id" = b."id" FROM "branches" b WHERE b."clinic_id" = t."clinic_id";
UPDATE "notifications" t SET "branch_id" = b."id" FROM "branches" b WHERE b."clinic_id" = t."clinic_id";
UPDATE "audit_logs" u SET "branch_id" = b."id" FROM "branches" b WHERE b."clinic_id" = u."clinic_id";

-- Defense in depth: fail loudly, by table, if the backfill above somehow
-- missed a row on one of the 11 tables where branch_id will become NOT
-- NULL in the next migration — a generic "column contains NULL" error
-- from the ALTER wouldn't say which table or why. (users/audit_logs are
-- excluded: NULL branch_id is a valid, expected state on both.)
DO $$
DECLARE
  missing INT;
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'doctors', 'patients', 'queue_entries', 'consultations', 'medicines',
    'stock_movements', 'medicines_dispensed', 'payments', 'remittances',
    'expenses', 'notifications'
  ]
  LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE branch_id IS NULL', tbl) INTO missing;
    IF missing > 0 THEN
      RAISE EXCEPTION 'branch_id backfill incomplete on table "%": % row(s) still NULL', tbl, missing;
    END IF;
  END LOOP;
END $$;
