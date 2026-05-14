-- ============================================================================
-- EchoBrief AI — Authorization
--
-- The original migration used Supabase-specific RLS with auth.uid().
-- On Railway Postgres we enforce authorization at the application layer:
-- every query in src/server/db/* includes a `WHERE user_id = $user_id`
-- clause, sourced from the JWT-authenticated request.
--
-- If you later want defense-in-depth RLS, the pattern is:
--   1. SET LOCAL app.user_id = '<uuid>' at the start of each request
--   2. RLS policies USING (user_id = current_setting('app.user_id')::uuid)
--
-- This migration is intentionally a no-op so the file stays in the sequence.
-- ============================================================================

SELECT 1;
