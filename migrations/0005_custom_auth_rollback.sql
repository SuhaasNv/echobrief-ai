-- Rollback: 0005_custom_auth.sql
BEGIN;
ALTER TABLE public.users DROP COLUMN IF EXISTS is_admin;
ALTER TABLE public.users DROP COLUMN IF EXISTS password_hash;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS clerk_user_id TEXT;
COMMIT;
