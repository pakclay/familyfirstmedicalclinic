-- audit_logs is the one RLS-policied table an administration-only role must
-- WRITE to. Every administrative audit row carries the branch it acted ON
-- (createUser writes the new user's branch, createBranch the new branch),
-- while a branchless clinic admin runs with app.branch_id = '' (see
-- lib/db/rls.ts). Under the existing INSERT policy that row matches no arm,
-- the INSERT is refused, and the whole transaction rolls back — every
-- action the role exists to perform would fail.
--
-- app.clinic_id is a fourth session GUC, set by lib/db/rls.ts alongside the
-- other three. It means "the ACTING user's clinic" and nothing else. The
-- retired enable_rls_backstop migration once used the same name to mean the
-- ROW's clinic — anyone reading history should not conflate them.
--
-- SELECT is deliberately not widened. Audit rows carry patient.read
-- entityIds — operational data this role must never see — and the SELECT
-- policy sits two lines above this one, which is exactly where a careless
-- follow-up would copy the new arm. The tenant-isolation test pins that.
--
-- 'CLINIC_ADMIN' below is a text literal compared against current_setting,
-- never the enum value, so this file has no 55P04 dependency on the ADD
-- VALUE two migrations back.
DROP POLICY "branch_scope_insert" ON "audit_logs";
CREATE POLICY branch_scope_insert ON "audit_logs" FOR INSERT
  WITH CHECK (
    branch_id IS NULL
    OR branch_id::text = current_setting('app.branch_id', true)
    OR current_setting('app.role', true) = 'HOLDING_ADMIN'
    OR (
      current_setting('app.role', true) = 'CLINIC_ADMIN'
      AND nullif(current_setting('app.clinic_id', true), '') IS NOT NULL
      AND branch_id IN (
        SELECT id FROM branches
        WHERE clinic_id::text = current_setting('app.clinic_id', true)
      )
    )
  );
