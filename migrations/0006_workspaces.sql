-- ============================================================================
-- EchoBrief AI — Enforce workspaces as a data-partition boundary
-- Migration: 0006_workspaces.sql
--
-- The workspaces + workspace_members tables already exist (0001), but nothing
-- in the API filters by workspace_id. This migration:
--
--   1. Adds a `color` token column on workspaces (UI-only metadata).
--   2. Backfills a "Personal" workspace for every existing user.
--   3. Backfills workspace_id on every meeting (using the meeting owner).
--   4. Backfills workspace_id on transcript_chunks + action_items by joining
--      through meetings.
--   5. Makes workspace_id NOT NULL on meetings + transcript_chunks +
--      action_items (the user-scoped read tables) — chat/comments cascade
--      from meetings so they're safe via FK.
--   6. Adds composite indexes on (workspace_id, ...) for the hot reads.
--
-- Idempotent: re-running is safe. Single transaction so a failure rolls back.
-- ============================================================================

BEGIN;

-- 1. Workspace UI metadata --------------------------------------------------
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS color TEXT NOT NULL DEFAULT 'brand'
    CHECK (color IN ('brand','violet','emerald','amber','rose','slate'));

-- 2. Backfill: one Personal workspace per user that has none ----------------
INSERT INTO public.workspaces (id, name, owner_id, color)
SELECT gen_random_uuid(), 'Personal', u.id, 'brand'
FROM public.users u
WHERE NOT EXISTS (
  SELECT 1 FROM public.workspaces w WHERE w.owner_id = u.id
);

-- Owner is implicitly an admin member.
INSERT INTO public.workspace_members (workspace_id, user_id, role)
SELECT w.id, w.owner_id, 'admin'
FROM public.workspaces w
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- 3. Backfill workspace_id on meetings (use the owner's first workspace) ----
UPDATE public.meetings m
SET workspace_id = (
  SELECT w.id FROM public.workspaces w
  WHERE w.owner_id = m.user_id
  ORDER BY w.created_at ASC
  LIMIT 1
)
WHERE m.workspace_id IS NULL;

-- 4. Backfill workspace_id on every user-scoped child table -----------------
ALTER TABLE public.action_items
  ADD COLUMN IF NOT EXISTS workspace_id UUID
    REFERENCES public.workspaces(id) ON DELETE CASCADE;

UPDATE public.action_items ai
SET workspace_id = m.workspace_id
FROM public.meetings m
WHERE ai.meeting_id = m.id AND ai.workspace_id IS NULL;

ALTER TABLE public.transcript_chunks
  ADD COLUMN IF NOT EXISTS workspace_id UUID
    REFERENCES public.workspaces(id) ON DELETE CASCADE;

UPDATE public.transcript_chunks tc
SET workspace_id = m.workspace_id
FROM public.meetings m
WHERE tc.meeting_id = m.id AND tc.workspace_id IS NULL;

-- 5. Enforce NOT NULL on the hot tables -------------------------------------
ALTER TABLE public.meetings
  ALTER COLUMN workspace_id SET NOT NULL;

ALTER TABLE public.meetings
  DROP CONSTRAINT IF EXISTS meetings_workspace_id_fkey;
ALTER TABLE public.meetings
  ADD CONSTRAINT meetings_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id)
    ON DELETE CASCADE;

ALTER TABLE public.action_items
  ALTER COLUMN workspace_id SET NOT NULL;

ALTER TABLE public.transcript_chunks
  ALTER COLUMN workspace_id SET NOT NULL;

-- 6. Composite indexes for the hot reads ------------------------------------
CREATE INDEX IF NOT EXISTS meetings_workspace_created_idx
  ON public.meetings(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS action_items_workspace_idx
  ON public.action_items(workspace_id, completed, due_date);

CREATE INDEX IF NOT EXISTS transcript_chunks_workspace_idx
  ON public.transcript_chunks(workspace_id);

CREATE INDEX IF NOT EXISTS workspaces_owner_idx
  ON public.workspaces(owner_id, created_at);

COMMIT;
