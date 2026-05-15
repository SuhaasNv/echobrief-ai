-- ============================================================================
-- EchoBrief AI — Clerk integration
-- Migration: 0004_clerk_user_id.sql
--
-- Clerk owns the auth surface (signup, login, sessions). We keep our existing
-- UUID-keyed `users` table for everything app-side (meetings, action items,
-- etc. all reference users.id) and join the two worlds via `clerk_user_id`.
--
-- On the first authenticated request for a Clerk user we don't yet know about,
-- the API middleware fetches the user from Clerk's API and INSERTs a row here
-- (just-in-time provisioning). No webhooks needed for MVP.
-- ============================================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS clerk_user_id TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS users_clerk_user_id_idx ON public.users(clerk_user_id);
