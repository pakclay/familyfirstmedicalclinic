-- Row Level Security backstop for §5's hard rule: "every query that touches
-- patient, queue, or money data must be scoped by clinic_id, derived from
-- the authenticated user's assignment — never from a client-supplied
-- parameter." The app layer enforces this too (a shared scoping helper —
-- see lib/permissions), but RLS makes the boundary hold even if an
-- application-layer check is missing or buggy.
--
-- This only restricts anything when Postgres connects as a non-superuser
-- role — superusers unconditionally bypass RLS. The app's runtime
-- connection (APP_DATABASE_URL, role `webinar_app`) is non-superuser;
-- `prisma migrate`/`generate` still use the superuser role (DATABASE_URL).
-- See lib/db/prisma.ts and DECISIONS.md.
--
-- Session GUCs (set per-request via `SET LOCAL` inside a transaction —
-- see lib/db/rls.ts):
--   app.role      -- the acting user's Role enum value, as text
--   app.user_id   -- the acting user's id
--   app.clinic_id -- the acting user's clinic_id, or '' for a holding admin
--
-- HOLDING_ADMIN has no single clinic_id, so its policies check
-- `app.role = 'HOLDING_ADMIN'` instead of a clinic match.
--
-- Deliberately no DELETE policy on any of these tables: §10/§6 require
-- soft deletes only, never hard deletes, from the running app. With no
-- policy defined for a command, Postgres denies it outright for every
-- role, `webinar_app` included — so the database itself refuses a hard
-- DELETE rather than relying on every future query to remember not to
-- issue one. Test fixture teardown uses the superuser connection instead
-- (lib/test/superuser-prisma.ts).

ALTER TABLE "patients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "queue_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "consultations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "medicines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_movements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "medicines_dispensed" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "remittances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "expenses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY clinic_scope_select ON "patients" FOR SELECT
  USING (clinic_id::text = current_setting('app.clinic_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');
CREATE POLICY clinic_scope_insert ON "patients" FOR INSERT
  WITH CHECK (clinic_id::text = current_setting('app.clinic_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');
CREATE POLICY clinic_scope_update ON "patients" FOR UPDATE
  USING (clinic_id::text = current_setting('app.clinic_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN')
  WITH CHECK (clinic_id::text = current_setting('app.clinic_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');

CREATE POLICY clinic_scope_select ON "queue_entries" FOR SELECT
  USING (clinic_id::text = current_setting('app.clinic_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');
CREATE POLICY clinic_scope_insert ON "queue_entries" FOR INSERT
  WITH CHECK (clinic_id::text = current_setting('app.clinic_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');
CREATE POLICY clinic_scope_update ON "queue_entries" FOR UPDATE
  USING (clinic_id::text = current_setting('app.clinic_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN')
  WITH CHECK (clinic_id::text = current_setting('app.clinic_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');

CREATE POLICY clinic_scope_select ON "consultations" FOR SELECT
  USING (clinic_id::text = current_setting('app.clinic_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');
CREATE POLICY clinic_scope_insert ON "consultations" FOR INSERT
  WITH CHECK (clinic_id::text = current_setting('app.clinic_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');
CREATE POLICY clinic_scope_update ON "consultations" FOR UPDATE
  USING (clinic_id::text = current_setting('app.clinic_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN')
  WITH CHECK (clinic_id::text = current_setting('app.clinic_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');

CREATE POLICY clinic_scope_select ON "medicines" FOR SELECT
  USING (clinic_id::text = current_setting('app.clinic_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');
CREATE POLICY clinic_scope_insert ON "medicines" FOR INSERT
  WITH CHECK (clinic_id::text = current_setting('app.clinic_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');
CREATE POLICY clinic_scope_update ON "medicines" FOR UPDATE
  USING (clinic_id::text = current_setting('app.clinic_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN')
  WITH CHECK (clinic_id::text = current_setting('app.clinic_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');

CREATE POLICY clinic_scope_select ON "stock_movements" FOR SELECT
  USING (clinic_id::text = current_setting('app.clinic_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');
CREATE POLICY clinic_scope_insert ON "stock_movements" FOR INSERT
  WITH CHECK (clinic_id::text = current_setting('app.clinic_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');

CREATE POLICY clinic_scope_select ON "medicines_dispensed" FOR SELECT
  USING (clinic_id::text = current_setting('app.clinic_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');
CREATE POLICY clinic_scope_insert ON "medicines_dispensed" FOR INSERT
  WITH CHECK (clinic_id::text = current_setting('app.clinic_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');
CREATE POLICY clinic_scope_update ON "medicines_dispensed" FOR UPDATE
  USING (clinic_id::text = current_setting('app.clinic_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN')
  WITH CHECK (clinic_id::text = current_setting('app.clinic_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');

CREATE POLICY clinic_scope_select ON "payments" FOR SELECT
  USING (clinic_id::text = current_setting('app.clinic_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');
CREATE POLICY clinic_scope_insert ON "payments" FOR INSERT
  WITH CHECK (clinic_id::text = current_setting('app.clinic_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');

CREATE POLICY clinic_scope_select ON "remittances" FOR SELECT
  USING (clinic_id::text = current_setting('app.clinic_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');
CREATE POLICY clinic_scope_insert ON "remittances" FOR INSERT
  WITH CHECK (clinic_id::text = current_setting('app.clinic_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');
CREATE POLICY clinic_scope_update ON "remittances" FOR UPDATE
  USING (clinic_id::text = current_setting('app.clinic_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN')
  WITH CHECK (clinic_id::text = current_setting('app.clinic_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');

CREATE POLICY clinic_scope_select ON "expenses" FOR SELECT
  USING (clinic_id::text = current_setting('app.clinic_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');
CREATE POLICY clinic_scope_insert ON "expenses" FOR INSERT
  WITH CHECK (clinic_id::text = current_setting('app.clinic_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');

CREATE POLICY clinic_scope_select ON "notifications" FOR SELECT
  USING (clinic_id::text = current_setting('app.clinic_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');
CREATE POLICY clinic_scope_insert ON "notifications" FOR INSERT
  WITH CHECK (clinic_id::text = current_setting('app.clinic_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');
CREATE POLICY clinic_scope_update ON "notifications" FOR UPDATE
  USING (clinic_id::text = current_setting('app.clinic_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN')
  WITH CHECK (clinic_id::text = current_setting('app.clinic_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');

-- audit_logs.clinic_id is nullable (holding-level actions aren't tied to
-- one clinic) — a NULL clinic_id row only ever satisfies the HOLDING_ADMIN
-- branch, which is correct: only holding admins act outside a clinic.
CREATE POLICY clinic_scope_select ON "audit_logs" FOR SELECT
  USING (clinic_id::text = current_setting('app.clinic_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');
CREATE POLICY clinic_scope_insert ON "audit_logs" FOR INSERT
  WITH CHECK (clinic_id IS NULL OR clinic_id::text = current_setting('app.clinic_id', true) OR current_setting('app.role', true) = 'HOLDING_ADMIN');
