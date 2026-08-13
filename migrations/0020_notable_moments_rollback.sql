-- Rollback for 0020_notable_moments.sql
--
-- Drops the moments the analyst extracted for every meeting. This one loses
-- data rather than reverting a setting: the moments were derived from the
-- transcript by a model call that has already been paid for, and dropping the
-- column throws them away. The transcripts they were drawn from are untouched,
-- so a re-analysis would produce moments again — not necessarily the same ones.
--
-- Roll it back together with the code that reads it: the meeting detail
-- endpoint SELECTs this column by name and the worker writes it in the
-- summaries upsert, so both fail on an unknown column if the code outlives the
-- schema.

ALTER TABLE public.summaries
  DROP COLUMN IF EXISTS notable_moments;
