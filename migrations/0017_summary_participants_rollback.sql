-- Rollback for 0017_summary_participants.sql
--
-- Drops the participant list the model produced for each meeting. The names are
-- not recoverable from anything else on the row: they come from the model
-- hearing someone introduce or address a person, which is exactly the evidence
-- a later regex over the stored transcript cannot reconstruct. Re-running the
-- analysis would regenerate them, at the cost of another full model call per
-- meeting.
--
-- Nothing breaks structurally: `summary.participants` is optional on the shared
-- response type, and both the worker's INSERT and the meeting GET treat an
-- absent list the same as an empty one. Roll this back with the code that reads
-- it or the INSERT will fail on an unknown column.

ALTER TABLE public.summaries
  DROP COLUMN IF EXISTS participants;
