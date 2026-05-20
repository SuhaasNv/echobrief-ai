-- Rollback: 0002_rls_policies.sql
BEGIN;
DROP POLICY IF EXISTS users_self ON public.users;
DROP POLICY IF EXISTS meetings_user ON public.meetings;
DROP POLICY IF EXISTS transcripts_user ON public.transcripts;
DROP POLICY IF EXISTS action_items_user ON public.action_items;
ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.meetings DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcripts DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.action_items DISABLE ROW LEVEL SECURITY;
COMMIT;
