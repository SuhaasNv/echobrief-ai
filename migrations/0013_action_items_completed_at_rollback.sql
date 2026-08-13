-- Rollback for 0013_action_items_completed_at.sql
--
-- Drops only the index. The `completed_at` column is NOT dropped: it predates
-- this migration (see 0001_initial_schema.sql), so dropping it here would
-- destroy data this migration never created, and would break the pre-0013
-- PATCH handler, which already wrote to it.
--
-- Without the index the Done list still sorts correctly, just with an explicit
-- sort step. That is the pre-0013 behaviour.

DROP INDEX IF EXISTS public.action_items_completed_at_idx;
