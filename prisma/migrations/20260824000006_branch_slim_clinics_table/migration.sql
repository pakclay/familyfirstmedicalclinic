-- Step 6 of 6: Clinic becomes purely organizational (matching
-- HoldingCompany's shape — id, parent link, name, timestamps). Every
-- operational field it used to carry now lives on Branch instead, already
-- populated for every existing clinic by the backfill in
-- 20260824000002_branch_backfill_data.
DROP INDEX "clinics_slug_key";
ALTER TABLE "clinics" DROP COLUMN "slug";
ALTER TABLE "clinics" DROP COLUMN "address";
ALTER TABLE "clinics" DROP COLUMN "city";
ALTER TABLE "clinics" DROP COLUMN "phone";
ALTER TABLE "clinics" DROP COLUMN "facebook_page_url";
ALTER TABLE "clinics" DROP COLUMN "timezone";
ALTER TABLE "clinics" DROP COLUMN "operating_hours";
ALTER TABLE "clinics" DROP COLUMN "is_active";
