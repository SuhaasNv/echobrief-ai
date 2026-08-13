-- Rollback for 0019_profanity_filter.sql
--
-- Drops the profanity preference. Every user who turned it on loses it and
-- transcription reverts to verbatim for everyone — which is the pre-0019
-- behaviour, so nothing already transcribed changes, but the next recording
-- made by a user who had asked for filtering will not be filtered.
--
-- Roll it back together with the code that reads it: the preferences endpoint
-- SELECTs this column by name and the worker reads it when building the
-- AssemblyAI request, so both will fail on an unknown column if the code
-- outlives the schema.

ALTER TABLE public.user_preferences
  DROP COLUMN IF EXISTS filter_profanity;
