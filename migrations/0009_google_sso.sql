-- ============================================================================
-- EchoBrief AI — Google SSO
-- Migration: 0009_google_sso.sql
--
-- Adds Google as a sign-in provider alongside email/password. `password_hash`
-- was already nullable (0005) precisely so OAuth-only users could exist, so no
-- change is needed there.
--
--   - google_id  Google's stable subject claim (`sub`). UNIQUE so one Google
--                account maps to exactly one EchoBrief user. NULL for
--                password-only users.
--
-- Account linking is by verified email: if someone signs up with a password
-- and later uses Google with the same address, the existing row is linked
-- rather than duplicated. The callback only links when Google reports
-- email_verified, so this cannot be used to hijack an account by registering
-- an unverified address at an identity provider.
-- ============================================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS google_id TEXT;

-- Partial unique index: many rows have NULL google_id (password users), and a
-- plain UNIQUE constraint would be fine with that, but a partial index keeps
-- the index small and makes the intent explicit.
CREATE UNIQUE INDEX IF NOT EXISTS users_google_id_key
  ON public.users (google_id)
  WHERE google_id IS NOT NULL;
