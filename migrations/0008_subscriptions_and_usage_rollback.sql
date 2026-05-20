-- ============================================================================
-- EchoBrief AI — Rollback Subscriptions & Usage Tracking
-- Migration: 0008_subscriptions_and_usage_rollback.sql
-- ============================================================================

BEGIN;

-- Drop tables in reverse order (respecting foreign keys)
DROP TABLE IF EXISTS public.usage_logs CASCADE;
DROP TABLE IF EXISTS public.subscriptions CASCADE;

COMMIT;
