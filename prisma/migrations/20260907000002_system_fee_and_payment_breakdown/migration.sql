-- An optional per-branch "system fee" added to every consultation's bill,
-- and the itemized bill behind each payment. See lib/utils/billing.ts.
--
-- The fee is a toggle plus an amount (centavos) rather than one nullable
-- column, so switching it off keeps the amount for when it comes back on.
ALTER TABLE "branches" ADD COLUMN "system_fee_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "branches" ADD COLUMN "system_fee_amount" INTEGER NOT NULL DEFAULT 0;

-- What was billed, line by line, at the time: the doctor's fee that day,
-- dispensed medicines at their catalog price, the branch's system fee if
-- any, and VAT if the doctor added it. `amount` stays what was actually
-- collected, which may differ (discount, partial payment). Rows from
-- before this migration carry zeros — their breakdown was never recorded
-- and cannot be reconstructed, because the doctor's fee may have changed
-- since.
ALTER TABLE "payments" ADD COLUMN "consultation_fee_amount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "payments" ADD COLUMN "medicines_amount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "payments" ADD COLUMN "system_fee_amount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "payments" ADD COLUMN "vat_amount" INTEGER NOT NULL DEFAULT 0;
