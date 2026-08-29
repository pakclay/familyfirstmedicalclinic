-- Step 5 of 6: drop the now-superseded clinic_id columns. Postgres drops
-- each column's own FK constraint to "clinics" automatically along with
-- the column, so no explicit DROP CONSTRAINT is needed here.
ALTER TABLE "users" DROP COLUMN "clinic_id";
ALTER TABLE "doctors" DROP COLUMN "clinic_id";
ALTER TABLE "patients" DROP COLUMN "clinic_id";
ALTER TABLE "queue_entries" DROP COLUMN "clinic_id";
ALTER TABLE "consultations" DROP COLUMN "clinic_id";
ALTER TABLE "medicines" DROP COLUMN "clinic_id";
ALTER TABLE "stock_movements" DROP COLUMN "clinic_id";
ALTER TABLE "medicines_dispensed" DROP COLUMN "clinic_id";
ALTER TABLE "payments" DROP COLUMN "clinic_id";
ALTER TABLE "remittances" DROP COLUMN "clinic_id";
ALTER TABLE "expenses" DROP COLUMN "clinic_id";
ALTER TABLE "notifications" DROP COLUMN "clinic_id";
ALTER TABLE "audit_logs" DROP COLUMN "clinic_id";
