-- A clinic admin belongs to a clinic the way a holding admin belongs to a
-- company and everyone else belongs to a branch. Nullable: every other role
-- leaves it NULL, and the CHECK constraint two files on pins exactly which
-- roles carry which of the three links.
--
-- Same FK actions as users.branch_id and users.holding_company_id
-- (SET NULL on delete, CASCADE on update). No index — the column is only
-- ever read alongside a role predicate on a table of a few dozen rows.
ALTER TABLE "users" ADD COLUMN "clinic_id" TEXT;
ALTER TABLE "users" ADD CONSTRAINT "users_clinic_id_fkey"
  FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
