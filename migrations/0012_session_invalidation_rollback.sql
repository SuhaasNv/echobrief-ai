-- Rollback for 0012_session_invalidation.sql
--
-- Drops the session cutoff. Tokens revert to being valid until their own `exp`,
-- which means a password change no longer revokes outstanding bearer tokens.
-- Only roll this back together with the requireAuth code that reads the column.

ALTER TABLE public.users
  DROP COLUMN IF EXISTS sessions_valid_from;
