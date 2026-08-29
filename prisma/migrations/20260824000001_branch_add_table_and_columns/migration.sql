-- Insert a Branch tier under Clinic. See DECISIONS.md for the full
-- rationale. This migration is the first of 6, split by hand (not
-- Prisma's autodiff) because a single-shot NOT NULL column add + backfill
-- + column drop cannot happen atomically against non-empty tables.
--
-- Step 1 of 6: purely additive DDL, safe to apply under live traffic.
-- Creates "branches" and adds a nullable, unconstrained "branch_id" to
-- every table that will be re-scoped from "clinic_id". No data moves yet
-- (see 20260824000002_branch_backfill_data) and nothing is dropped yet
-- (see 20260824000005_branch_drop_clinic_id_columns and
-- 20260824000006_branch_slim_clinics_table).

-- CreateTable
CREATE TABLE "branches" (
    "id" TEXT NOT NULL,
    "clinic_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "facebook_page_url" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Manila',
    "operating_hours" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "branches_slug_key" ON "branches"("slug");

CREATE INDEX "branches_clinic_id_idx" ON "branches"("clinic_id");

ALTER TABLE "branches" ADD CONSTRAINT "branches_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddColumn: nullable, no FK yet — backfilled in the next migration, then
-- constrained (NOT NULL where required, FK added) in the one after that.
ALTER TABLE "users" ADD COLUMN "branch_id" TEXT;
ALTER TABLE "doctors" ADD COLUMN "branch_id" TEXT;
ALTER TABLE "patients" ADD COLUMN "branch_id" TEXT;
ALTER TABLE "queue_entries" ADD COLUMN "branch_id" TEXT;
ALTER TABLE "consultations" ADD COLUMN "branch_id" TEXT;
ALTER TABLE "medicines" ADD COLUMN "branch_id" TEXT;
ALTER TABLE "stock_movements" ADD COLUMN "branch_id" TEXT;
ALTER TABLE "medicines_dispensed" ADD COLUMN "branch_id" TEXT;
ALTER TABLE "payments" ADD COLUMN "branch_id" TEXT;
ALTER TABLE "remittances" ADD COLUMN "branch_id" TEXT;
ALTER TABLE "expenses" ADD COLUMN "branch_id" TEXT;
ALTER TABLE "notifications" ADD COLUMN "branch_id" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN "branch_id" TEXT;
