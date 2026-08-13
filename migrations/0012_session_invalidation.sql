-- ============================================================================
-- EchoBrief AI — Session invalidation cutoff
-- Migration: 0012_session_invalidation.sql
--
-- JWTs are stateless, HS256, and live for 7 days. Until now nothing could
-- retire one early: a user who changed their password because someone else had
-- it left that someone else with a working bearer token for up to a week. The
-- password change was cosmetic against exactly the attacker it exists to stop.
--
-- `sessions_valid_from` is the cutoff. requireAuth rejects any token whose
-- `iat` predates it, so bumping the column to now() logs every existing session
-- out. Password changes bump it; a future "sign out everywhere" would too.
--
-- Backfilled to created_at rather than now() ON PURPOSE: `ADD COLUMN ...
-- DEFAULT now()` stamps every existing row with the deploy timestamp and force
-- logs out the entire user base on release. New rows still default to now().
-- ============================================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS sessions_valid_from TIMESTAMPTZ;

UPDATE public.users
  SET sessions_valid_from = created_at
  WHERE sessions_valid_from IS NULL;

ALTER TABLE public.users
  ALTER COLUMN sessions_valid_from SET DEFAULT now();

ALTER TABLE public.users
  ALTER COLUMN sessions_valid_from SET NOT NULL;
