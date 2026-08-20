-- §4.2 backstop: Postgres Row Level Security on the four tables the spec
-- names (Patient, SessionNote, Payment, PayoutResult). This is defense in
-- depth, not the primary mechanism — the application layer (ability.ts +
-- the query layer in lib/queries/) is what denies loudly with a
-- ForbiddenError. RLS exists so that a bug in the app layer (a
-- mis-written query missing its `where`) fails closed instead of leaking
-- rows.
--
-- IMPORTANT: these policies only take effect for connections that are NOT
-- Postgres superusers — superusers unconditionally bypass RLS. The app
-- must connect via APP_DATABASE_URL (the `webinar_app` role), not
-- DATABASE_URL (the superuser used for migrations). See DECISIONS.md.
--
-- Session context is set per-request via set_config('app.role', ...) etc.
-- in lib/db/rls.ts, inside the same Postgres transaction as the queries
-- that need it (SET LOCAL semantics — never leaks across pooled
-- connections). When those GUCs are unset, current_setting(..., true)
-- returns NULL, every USING/CHECK clause evaluates to NULL (falsy), and
-- the policy denies by default — fail closed.

-- ─── Patient (patientDemographics) ─────────────────────────────────────
ALTER TABLE "Patient" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Patient" FORCE ROW LEVEL SECURITY;

CREATE POLICY patient_select ON "Patient" FOR SELECT USING (
  current_setting('app.role', true) = 'OWNER'
  OR current_setting('app.role', true) = 'DOCTOR'
  OR (current_setting('app.role', true) = 'BRANCH_MANAGER' AND "homeBranchId" = current_setting('app.branch_id', true))
  OR (current_setting('app.role', true) = 'FRONT_DESK' AND "homeBranchId" = current_setting('app.branch_id', true))
  OR (current_setting('app.role', true) = 'THERAPIST' AND "primaryTherapistId" = current_setting('app.user_id', true))
);

CREATE POLICY patient_insert ON "Patient" FOR INSERT WITH CHECK (
  current_setting('app.role', true) = 'OWNER'
  OR (current_setting('app.role', true) = 'BRANCH_MANAGER' AND "homeBranchId" = current_setting('app.branch_id', true))
  OR (current_setting('app.role', true) = 'FRONT_DESK' AND "homeBranchId" = current_setting('app.branch_id', true))
);

CREATE POLICY patient_update ON "Patient" FOR UPDATE USING (
  current_setting('app.role', true) = 'OWNER'
  OR (current_setting('app.role', true) = 'BRANCH_MANAGER' AND "homeBranchId" = current_setting('app.branch_id', true))
  OR (current_setting('app.role', true) = 'FRONT_DESK' AND "homeBranchId" = current_setting('app.branch_id', true))
);

-- ─── SessionNote (soapNotes) ────────────────────────────────────────────
ALTER TABLE "SessionNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SessionNote" FORCE ROW LEVEL SECURITY;

CREATE POLICY session_note_select ON "SessionNote" FOR SELECT USING (
  current_setting('app.role', true) = 'OWNER'
  OR current_setting('app.role', true) = 'DOCTOR'
  OR (current_setting('app.role', true) = 'THERAPIST' AND "therapistId" = current_setting('app.user_id', true))
);

CREATE POLICY session_note_insert ON "SessionNote" FOR INSERT WITH CHECK (
  current_setting('app.role', true) = 'DOCTOR'
  OR (current_setting('app.role', true) = 'THERAPIST' AND "therapistId" = current_setting('app.user_id', true))
);

CREATE POLICY session_note_update ON "SessionNote" FOR UPDATE USING (
  current_setting('app.role', true) = 'DOCTOR'
  OR (current_setting('app.role', true) = 'THERAPIST' AND "therapistId" = current_setting('app.user_id', true))
);

-- ─── Payment (payments — the money table) ───────────────────────────────
ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payment" FORCE ROW LEVEL SECURITY;

CREATE POLICY payment_select ON "Payment" FOR SELECT USING (
  current_setting('app.role', true) = 'OWNER'
  OR (current_setting('app.role', true) = 'BRANCH_MANAGER' AND "branchId" = current_setting('app.branch_id', true))
);

-- FRONT_DESK may record a payment but never read payment reports (§4.1) —
-- deliberately no SELECT access for FRONT_DESK here, matching
-- writeOnlyNoReports in ability.ts.
CREATE POLICY payment_insert ON "Payment" FOR INSERT WITH CHECK (
  current_setting('app.role', true) = 'OWNER'
  OR (current_setting('app.role', true) = 'FRONT_DESK' AND "branchId" = current_setting('app.branch_id', true))
);

CREATE POLICY payment_update ON "Payment" FOR UPDATE USING (
  current_setting('app.role', true) = 'OWNER'
);

-- ─── PayoutResult (therapist compensation) ──────────────────────────────
ALTER TABLE "PayoutResult" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayoutResult" FORCE ROW LEVEL SECURITY;

CREATE POLICY payout_result_select ON "PayoutResult" FOR SELECT USING (
  current_setting('app.role', true) = 'OWNER'
  OR (current_setting('app.role', true) = 'THERAPIST' AND "therapistId" = current_setting('app.user_id', true))
  OR (
    current_setting('app.role', true) = 'BRANCH_MANAGER'
    AND EXISTS (
      SELECT 1 FROM "QuotaPeriod" qp
      WHERE qp.id = "PayoutResult"."quotaPeriodId"
      AND qp."branchId" = current_setting('app.branch_id', true)
    )
  )
);

CREATE POLICY payout_result_insert ON "PayoutResult" FOR INSERT WITH CHECK (
  current_setting('app.role', true) = 'OWNER'
);

CREATE POLICY payout_result_update ON "PayoutResult" FOR UPDATE USING (
  current_setting('app.role', true) = 'OWNER'
);
