-- Rollback for 0011_recorded_at.sql
--
-- Drops the recording timestamp. Meetings fall back to created_at (upload
-- time) for display and ordering, which is the pre-0011 behaviour.

DROP INDEX IF EXISTS public.meetings_user_recorded_at_idx;

ALTER TABLE public.meetings
  DROP COLUMN IF EXISTS recorded_at;
