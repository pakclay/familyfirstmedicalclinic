-- Each role carries exactly one of the three scope links, and this makes
-- the other combinations unrepresentable rather than merely absent.
--
-- The load-bearing arm is ELSE. canManageTarget in lib/queries/users.ts
-- compares target.branchId === actor.branchId; for a branchless actor that
-- is `null === null`, so any branchless FRONT_DESK or DOCTOR row — in ANY
-- tenant — would be manageable by a branchless clinic admin. Zero such rows
-- exist today; this keeps it that way at the database, not by convention.
--
-- Deliberately does NOT require holding_company_id on HOLDING_ADMIN: most
-- existing holding-admin rows have none and would fail. A clinic admin
-- carries no holding_company_id on purpose — its company is reached through
-- its clinic — so a future missed role check fails closed, not open.
--
-- Its own file: naming 'CLINIC_ADMIN' in a CHECK is an enum-value use, and
-- Postgres refuses that in the transaction that added the value (55P04).
ALTER TABLE "users" ADD CONSTRAINT "users_role_scope_check" CHECK (
  CASE role
    WHEN 'HOLDING_ADMIN' THEN branch_id IS NULL AND clinic_id IS NULL
    WHEN 'CLINIC_ADMIN'  THEN branch_id IS NULL AND clinic_id IS NOT NULL
                              AND holding_company_id IS NULL
    ELSE branch_id IS NOT NULL AND clinic_id IS NULL
                              AND holding_company_id IS NULL
  END
);
