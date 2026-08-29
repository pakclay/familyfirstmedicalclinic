-- Vitals on the visit, so front-desk staff can record them at check-in.
--
-- They already existed as consultations.vitals, but only a doctor could
-- ever write them: a Consultation row requires a doctor_id and is created
-- by saveConsultation. Vitals are taken at triage, before any of that
-- exists, so there was nowhere to put them until now.
--
-- Deliberately columns on queue_entries rather than a vitals table.
-- queue_entries already carries the branch RLS policies from
-- 20260824000004, so these ride along on the existing row and inherit that
-- isolation exactly; a separate table would need its own SELECT/INSERT/
-- UPDATE policies, and one branch tier's worth of experience says that is
-- the part most easily got wrong. Cardinality also matches -- one set of
-- vitals per visit, whereas consultations carry revisions and would
-- duplicate them across every revision of the same encounter.
--
-- consultations.vitals is NOT dropped and NOT moved. It stays as the
-- doctor's own record at the moment of the encounter; these are triage's.
-- The two are allowed to differ, which is clinically normal -- a patient
-- reweighed in the consultation room is not a data conflict.
--
-- Additive only. No column is dropped, no constraint tightened, and every
-- existing row simply gets NULLs.

ALTER TABLE "queue_entries" ADD COLUMN "vitals" JSONB;
ALTER TABLE "queue_entries" ADD COLUMN "vitals_recorded_at" TIMESTAMP(3);
ALTER TABLE "queue_entries" ADD COLUMN "vitals_recorded_by" TEXT;

ALTER TABLE "queue_entries"
  ADD CONSTRAINT "queue_entries_vitals_recorded_by_fkey"
  FOREIGN KEY ("vitals_recorded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill from the consultation that already holds them, so past visits
-- keep their vitals on the visit record too. Takes the highest revision
-- per queue entry (consultations are append-only in spirit -- an edit
-- inserts a new revision rather than overwriting), ignores soft-deleted
-- rows, and skips consultations whose vitals were never filled in.
--
-- recorded_at is the consultation's own createdAt rather than now(), so a
-- backfilled reading is not misdated to the migration. recorded_by stays
-- NULL: the doctor who wrote it is on the consultation, and inventing a
-- user id here would claim provenance the old data never had.
UPDATE "queue_entries" q
SET
  "vitals" = c."vitals",
  "vitals_recorded_at" = c."created_at"
FROM (
  SELECT DISTINCT ON ("queue_entry_id")
    "queue_entry_id", "vitals", "created_at"
  FROM "consultations"
  WHERE "deleted_at" IS NULL
    AND "vitals" IS NOT NULL
    AND "vitals"::text <> '{}'
  ORDER BY "queue_entry_id", "revision_number" DESC
) c
WHERE q."id" = c."queue_entry_id";
