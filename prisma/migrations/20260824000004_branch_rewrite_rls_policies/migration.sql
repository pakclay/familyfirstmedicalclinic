-- Step 4 of 6: re-scope RLS from clinic_id to branch_id. Must happen
-- before the clinic_id columns are dropped (next migration) — the old
-- policies are still bound to clinic_id and Postgres refuses to drop a
-- column a policy depends on.
--
-- The GUC set per-request (SET LOCAL, inside a transaction — see
-- lib/db/rls.ts) is now:
--   app.role      -- the acting user's Role enum value, as text
--   app.user_id   -- the acting user's id
--   app.branch_id -- the acting user's branch_id, or '' for a holding admin
--
-- HOLDING_ADMIN has no single branch_id, so its policies check
-- `app.role = 'HOLDING_ADMIN'` instead of a branch match — unchanged
-- reasoning from the clinic-scoped policies this replaces.
--
-- "branches" itself is deliberately NOT given RLS here, matching "clinics"
-- before it: the public /book/{slug} and /display/{slug} routes resolve a
-- branch by slug with no session/GUCs available at all (see
-- lib/queries/booking.ts), and an RLS policy on "branches" would make that
-- unauthenticated lookup return nothing.
--
-- Same SELECT/INSERT/UPDATE shape per table as the policies being
-- replaced — the 4 append-only tables (stock_movements, payments,
-- expenses, audit_logs) still get no UPDATE policy.

DROP POLICY "clinic_scope_select" ON "patients";
DROP POLICY "clinic_scope_insert" ON "patients";
DROP POLICY "clinic_scope_update" ON "patients";
CREATE POLICY branch_scope_select ON "patients" FOR SELECT
  USING (branch_id::text = current_setting('app.branch_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');
CREATE POLICY branch_scope_insert ON "patients" FOR INSERT
  WITH CHECK (branch_id::text = current_setting('app.branch_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');
CREATE POLICY branch_scope_update ON "patients" FOR UPDATE
  USING (branch_id::text = current_setting('app.branch_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN')
  WITH CHECK (branch_id::text = current_setting('app.branch_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');

DROP POLICY "clinic_scope_select" ON "queue_entries";
DROP POLICY "clinic_scope_insert" ON "queue_entries";
DROP POLICY "clinic_scope_update" ON "queue_entries";
CREATE POLICY branch_scope_select ON "queue_entries" FOR SELECT
  USING (branch_id::text = current_setting('app.branch_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');
CREATE POLICY branch_scope_insert ON "queue_entries" FOR INSERT
  WITH CHECK (branch_id::text = current_setting('app.branch_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');
CREATE POLICY branch_scope_update ON "queue_entries" FOR UPDATE
  USING (branch_id::text = current_setting('app.branch_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN')
  WITH CHECK (branch_id::text = current_setting('app.branch_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');

DROP POLICY "clinic_scope_select" ON "consultations";
DROP POLICY "clinic_scope_insert" ON "consultations";
DROP POLICY "clinic_scope_update" ON "consultations";
CREATE POLICY branch_scope_select ON "consultations" FOR SELECT
  USING (branch_id::text = current_setting('app.branch_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');
CREATE POLICY branch_scope_insert ON "consultations" FOR INSERT
  WITH CHECK (branch_id::text = current_setting('app.branch_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');
CREATE POLICY branch_scope_update ON "consultations" FOR UPDATE
  USING (branch_id::text = current_setting('app.branch_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN')
  WITH CHECK (branch_id::text = current_setting('app.branch_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');

DROP POLICY "clinic_scope_select" ON "medicines";
DROP POLICY "clinic_scope_insert" ON "medicines";
DROP POLICY "clinic_scope_update" ON "medicines";
CREATE POLICY branch_scope_select ON "medicines" FOR SELECT
  USING (branch_id::text = current_setting('app.branch_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');
CREATE POLICY branch_scope_insert ON "medicines" FOR INSERT
  WITH CHECK (branch_id::text = current_setting('app.branch_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');
CREATE POLICY branch_scope_update ON "medicines" FOR UPDATE
  USING (branch_id::text = current_setting('app.branch_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN')
  WITH CHECK (branch_id::text = current_setting('app.branch_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');

DROP POLICY "clinic_scope_select" ON "stock_movements";
DROP POLICY "clinic_scope_insert" ON "stock_movements";
CREATE POLICY branch_scope_select ON "stock_movements" FOR SELECT
  USING (branch_id::text = current_setting('app.branch_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');
CREATE POLICY branch_scope_insert ON "stock_movements" FOR INSERT
  WITH CHECK (branch_id::text = current_setting('app.branch_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');

DROP POLICY "clinic_scope_select" ON "medicines_dispensed";
DROP POLICY "clinic_scope_insert" ON "medicines_dispensed";
DROP POLICY "clinic_scope_update" ON "medicines_dispensed";
CREATE POLICY branch_scope_select ON "medicines_dispensed" FOR SELECT
  USING (branch_id::text = current_setting('app.branch_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');
CREATE POLICY branch_scope_insert ON "medicines_dispensed" FOR INSERT
  WITH CHECK (branch_id::text = current_setting('app.branch_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');
CREATE POLICY branch_scope_update ON "medicines_dispensed" FOR UPDATE
  USING (branch_id::text = current_setting('app.branch_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN')
  WITH CHECK (branch_id::text = current_setting('app.branch_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');

DROP POLICY "clinic_scope_select" ON "payments";
DROP POLICY "clinic_scope_insert" ON "payments";
CREATE POLICY branch_scope_select ON "payments" FOR SELECT
  USING (branch_id::text = current_setting('app.branch_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');
CREATE POLICY branch_scope_insert ON "payments" FOR INSERT
  WITH CHECK (branch_id::text = current_setting('app.branch_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');

DROP POLICY "clinic_scope_select" ON "remittances";
DROP POLICY "clinic_scope_insert" ON "remittances";
DROP POLICY "clinic_scope_update" ON "remittances";
CREATE POLICY branch_scope_select ON "remittances" FOR SELECT
  USING (branch_id::text = current_setting('app.branch_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');
CREATE POLICY branch_scope_insert ON "remittances" FOR INSERT
  WITH CHECK (branch_id::text = current_setting('app.branch_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');
CREATE POLICY branch_scope_update ON "remittances" FOR UPDATE
  USING (branch_id::text = current_setting('app.branch_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN')
  WITH CHECK (branch_id::text = current_setting('app.branch_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');

DROP POLICY "clinic_scope_select" ON "expenses";
DROP POLICY "clinic_scope_insert" ON "expenses";
CREATE POLICY branch_scope_select ON "expenses" FOR SELECT
  USING (branch_id::text = current_setting('app.branch_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');
CREATE POLICY branch_scope_insert ON "expenses" FOR INSERT
  WITH CHECK (branch_id::text = current_setting('app.branch_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');

DROP POLICY "clinic_scope_select" ON "notifications";
DROP POLICY "clinic_scope_insert" ON "notifications";
DROP POLICY "clinic_scope_update" ON "notifications";
CREATE POLICY branch_scope_select ON "notifications" FOR SELECT
  USING (branch_id::text = current_setting('app.branch_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');
CREATE POLICY branch_scope_insert ON "notifications" FOR INSERT
  WITH CHECK (branch_id::text = current_setting('app.branch_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');
CREATE POLICY branch_scope_update ON "notifications" FOR UPDATE
  USING (branch_id::text = current_setting('app.branch_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN')
  WITH CHECK (branch_id::text = current_setting('app.branch_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');

-- audit_logs.branch_id is nullable (holding-level actions aren't tied to
-- one branch) — a NULL branch_id row only ever satisfies the HOLDING_ADMIN
-- branch of the check, which is correct: only holding admins act outside
-- a branch.
DROP POLICY "clinic_scope_select" ON "audit_logs";
DROP POLICY "clinic_scope_insert" ON "audit_logs";
CREATE POLICY branch_scope_select ON "audit_logs" FOR SELECT
  USING (branch_id::text = current_setting('app.branch_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');
CREATE POLICY branch_scope_insert ON "audit_logs" FOR INSERT
  WITH CHECK (branch_id IS NULL OR branch_id::text = current_setting('app.branch_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');
