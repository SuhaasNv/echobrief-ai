-- Rollback: 0006_workspaces.sql
BEGIN;
DROP INDEX IF EXISTS public.workspaces_owner_idx;
DROP INDEX IF EXISTS public.transcript_chunks_workspace_idx;
DROP INDEX IF EXISTS public.action_items_workspace_idx;
DROP INDEX IF EXISTS public.meetings_workspace_created_idx;
ALTER TABLE public.transcript_chunks ALTER COLUMN workspace_id DROP NOT NULL;
ALTER TABLE public.action_items ALTER COLUMN workspace_id DROP NOT NULL;
ALTER TABLE public.meetings ALTER COLUMN workspace_id DROP NOT NULL;
ALTER TABLE public.transcript_chunks DROP COLUMN IF EXISTS workspace_id;
ALTER TABLE public.action_items DROP COLUMN IF EXISTS workspace_id;
ALTER TABLE public.workspaces DROP COLUMN IF EXISTS color;
COMMIT;
