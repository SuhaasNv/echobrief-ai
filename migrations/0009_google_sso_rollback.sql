-- Rollback for 0009_google_sso.sql
--
-- NOTE: dropping google_id strands any user who signed up via Google and has
-- no password_hash — they will not be able to sign in until they use the
-- password reset flow to set one. Check for such rows before running this:
--   SELECT count(*) FROM users WHERE google_id IS NOT NULL AND password_hash IS NULL;

DROP INDEX IF EXISTS public.users_google_id_key;

ALTER TABLE public.users
  DROP COLUMN IF EXISTS google_id;
