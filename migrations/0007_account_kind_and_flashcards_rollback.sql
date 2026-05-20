-- Rollback: 0007_account_kind_and_flashcards.sql
BEGIN;
DROP INDEX IF EXISTS public.flashcards_user_review_idx;
DROP INDEX IF EXISTS public.flashcards_workspace_meeting_idx;
DROP TABLE IF EXISTS public.flashcards;
ALTER TABLE public.users DROP COLUMN IF EXISTS default_account_type;
DROP INDEX IF EXISTS public.workspaces_owner_kind_idx;
ALTER TABLE public.workspaces DROP COLUMN IF EXISTS kind;
COMMIT;
