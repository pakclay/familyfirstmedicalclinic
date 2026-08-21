-- Phase 4 correction: THERAPIST's "own" scope on Patient can't be just
-- primaryTherapistId. §6's workflow has the assessing PT reading a
-- patient's chart *before* any care plan (and therefore
-- primaryTherapistId) exists — the assessment happens during the
-- patient's first booked visit, before care-plan assignment. The RLS
-- policy has to allow that same appointment-based access the application
-- layer now checks (see requireReadScope() in lib/queries/patients.ts),
-- or the database backstop silently contradicts the app-layer decision.
--
-- Recreate patient_select (Postgres has no ALTER POLICY for changing the
-- USING expression — drop and recreate is the standard approach).

DROP POLICY patient_select ON "Patient";

CREATE POLICY patient_select ON "Patient" FOR SELECT USING (
  current_setting('app.role', true) = 'OWNER'
  OR current_setting('app.role', true) = 'DOCTOR'
  OR (current_setting('app.role', true) = 'BRANCH_MANAGER' AND "homeBranchId" = current_setting('app.branch_id', true))
  OR (current_setting('app.role', true) = 'FRONT_DESK' AND "homeBranchId" = current_setting('app.branch_id', true))
  OR (
    current_setting('app.role', true) = 'THERAPIST'
    AND (
      "primaryTherapistId" = current_setting('app.user_id', true)
      OR EXISTS (
        SELECT 1 FROM "Appointment" a
        WHERE a."patientId" = "Patient".id
        AND a."therapistId" = current_setting('app.user_id', true)
      )
    )
  )
);
