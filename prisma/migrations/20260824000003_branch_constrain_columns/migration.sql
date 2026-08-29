-- Step 3 of 6: constrain the now-backfilled branch_id columns.

-- SET NOT NULL on the 11 tables where a branch is mandatory. users and
-- audit_logs stay nullable (holding admins have no branch; some
-- audit_logs rows are clinic/branch-less system actions).
ALTER TABLE "doctors" ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "patients" ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "queue_entries" ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "consultations" ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "medicines" ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "stock_movements" ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "medicines_dispensed" ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "payments" ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "remittances" ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "expenses" ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "notifications" ALTER COLUMN "branch_id" SET NOT NULL;

-- AddForeignKey — same ON DELETE behavior per table as the clinic_id FK
-- it replaces (SET NULL for users/audit_logs, RESTRICT everywhere else).
ALTER TABLE "users" ADD CONSTRAINT "users_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "patients" ADD CONSTRAINT "patients_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "medicines" ADD CONSTRAINT "medicines_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "medicines_dispensed" ADD CONSTRAINT "medicines_dispensed_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "remittances" ADD CONSTRAINT "remittances_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Recreate the clinic_id-based indexes/uniques as branch_id-based.
DROP INDEX "patients_clinic_id_phone_idx";
CREATE INDEX "patients_branch_id_phone_idx" ON "patients"("branch_id", "phone");

DROP INDEX "patients_clinic_id_last_name_first_name_idx";
CREATE INDEX "patients_branch_id_last_name_first_name_idx" ON "patients"("branch_id", "last_name", "first_name");

DROP INDEX "queue_entries_clinic_id_queue_date_status_idx";
CREATE INDEX "queue_entries_branch_id_queue_date_status_idx" ON "queue_entries"("branch_id", "queue_date", "status");

DROP INDEX "queue_entries_clinic_id_queue_date_queue_number_key";
CREATE UNIQUE INDEX "queue_entries_branch_id_queue_date_queue_number_key" ON "queue_entries"("branch_id", "queue_date", "queue_number");

DROP INDEX "medicines_clinic_id_is_active_idx";
CREATE INDEX "medicines_branch_id_is_active_idx" ON "medicines"("branch_id", "is_active");

DROP INDEX "stock_movements_clinic_id_medicine_id_created_at_idx";
CREATE INDEX "stock_movements_branch_id_medicine_id_created_at_idx" ON "stock_movements"("branch_id", "medicine_id", "created_at");

DROP INDEX "payments_clinic_id_received_at_idx";
CREATE INDEX "payments_branch_id_received_at_idx" ON "payments"("branch_id", "received_at");

DROP INDEX "remittances_clinic_id_shift_date_idx";
CREATE INDEX "remittances_branch_id_shift_date_idx" ON "remittances"("branch_id", "shift_date");

DROP INDEX "expenses_clinic_id_expense_date_idx";
CREATE INDEX "expenses_branch_id_expense_date_idx" ON "expenses"("branch_id", "expense_date");

DROP INDEX "notifications_clinic_id_created_at_idx";
CREATE INDEX "notifications_branch_id_created_at_idx" ON "notifications"("branch_id", "created_at");

DROP INDEX "audit_logs_clinic_id_created_at_idx";
CREATE INDEX "audit_logs_branch_id_created_at_idx" ON "audit_logs"("branch_id", "created_at");
