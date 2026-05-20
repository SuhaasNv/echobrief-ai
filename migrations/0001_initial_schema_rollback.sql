-- Rollback: 0001_initial_schema.sql
-- WARNING: This drops ALL tables. Only use in development/testing.
BEGIN;
DROP TABLE IF EXISTS public.chat_messages CASCADE;
DROP TABLE IF EXISTS public.transcript_chunks CASCADE;
DROP TABLE IF EXISTS public.action_items CASCADE;
DROP TABLE IF EXISTS public.transcripts CASCADE;
DROP TABLE IF EXISTS public.meetings CASCADE;
DROP TABLE IF EXISTS public.workspace_members CASCADE;
DROP TABLE IF EXISTS public.workspaces CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;
DROP EXTENSION IF EXISTS vector;
COMMIT;
