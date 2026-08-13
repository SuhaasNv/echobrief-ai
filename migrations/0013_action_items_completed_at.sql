-- ============================================================================
-- EchoBrief AI — When an action item was completed
-- Migration: 0013_action_items_completed_at.sql
--
-- NOTE ON SCOPE. This migration was written to add `completed_at` to
-- action_items. It turns out the column already exists: 0001_initial_schema.sql
-- has declared it since the file was first committed (it is not a retroactive
-- edit, so every database migrated with this runner already has it). What was
-- missing was everything AROUND it — the API never returned it, the PATCH
-- handler rewrote it on every re-complete, and nothing indexed it.
--
-- The ADD COLUMN below is therefore a no-op guard on every known database. It
-- stays because it is idempotent and it makes this file honest about the
-- contract the application code from here on depends on: `completed_at` exists
-- and is nullable.
--
-- NO BACKFILL. Rows completed before the API started writing the column carry
-- completed_at IS NULL. We deliberately leave them NULL rather than stamping
-- them with updated_at, created_at, or now(). Any of those would render in the
-- UI as a specific day the user "finished" something, and the user would read
-- that as fact. An absent date is recoverable; a fabricated one is not. The
-- clients group these rows under "Completed earlier" and claim no date.
-- ============================================================================

ALTER TABLE public.action_items
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- The Done list orders most-recently-completed first. The existing composite
-- indexes are (user_id, completed, due_date) and (workspace_id, completed,
-- due_date): they serve the filter but leave the new sort to an explicit sort
-- step. Partial, because only completed rows are ever ordered this way, which
-- keeps the index off the hot path of the Open list.
--
-- Not CONCURRENTLY: this runner wraps each migration in a transaction.
CREATE INDEX IF NOT EXISTS action_items_completed_at_idx
  ON public.action_items (workspace_id, user_id, completed_at DESC NULLS LAST)
  WHERE completed;
