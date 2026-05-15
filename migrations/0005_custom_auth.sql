-- ============================================================================
-- EchoBrief AI — Custom JWT + argon2 auth
-- Migration: 0005_custom_auth.sql
--
-- Replaces the Clerk integration (0004) with self-hosted email/password.
-- Drops `clerk_user_id` (no longer referenced by anything) and adds:
--   - password_hash (NULL allowed so future OAuth users can exist password-less)
--   - is_admin       (gates /admin route + admin API endpoints)
-- ============================================================================

ALTER TABLE public.users
  DROP COLUMN IF EXISTS clerk_user_id;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS password_hash TEXT;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
