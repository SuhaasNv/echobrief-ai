-- ============================================================================
-- EchoBrief AI — Student vs Professional fork + flashcards
-- Migration: 0007_account_kind_and_flashcards.sql
--
-- 1. workspaces.kind             — drives the per-workspace UX fork
-- 2. users.default_account_type  — remembers the signup answer (UX hint only)
-- 3. flashcards table             — student-only: AI-generated Q/A from a
--                                   meeting transcript, with a review queue
--
-- Existing workspaces default to 'professional' so the 3 seeded users keep
-- their current UX. They can opt in to a student workspace anytime via the
-- sidebar switcher.
-- ============================================================================

BEGIN;

-- 1. Workspace kind ---------------------------------------------------------
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'professional'
    CHECK (kind IN ('student','professional'));

CREATE INDEX IF NOT EXISTS workspaces_owner_kind_idx
  ON public.workspaces(owner_id, kind);

-- 2. User UX hint -----------------------------------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS default_account_type TEXT
    CHECK (default_account_type IN ('student','professional'));

-- 3. Flashcards -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.flashcards (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id        UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  workspace_id      UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  question          TEXT NOT NULL,
  answer            TEXT NOT NULL,
  difficulty        TEXT CHECK (difficulty IN ('easy','medium','hard')),
  last_reviewed_at  TIMESTAMPTZ,
  review_count      INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS flashcards_workspace_meeting_idx
  ON public.flashcards(workspace_id, meeting_id);

-- Review queue: "least recently reviewed first" with NULLs (never seen) at top.
CREATE INDEX IF NOT EXISTS flashcards_user_review_idx
  ON public.flashcards(user_id, last_reviewed_at NULLS FIRST);

COMMIT;
