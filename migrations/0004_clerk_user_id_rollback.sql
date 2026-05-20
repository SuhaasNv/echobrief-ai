-- Rollback: 0004_clerk_user_id.sql (obsolete)
BEGIN;
ALTER TABLE public.users DROP COLUMN IF EXISTS clerk_user_id;
COMMIT;
