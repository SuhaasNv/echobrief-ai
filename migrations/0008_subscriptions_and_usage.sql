-- ============================================================================
-- EchoBrief AI — Subscriptions & Usage Tracking
-- Migration: 0008_subscriptions_and_usage.sql
--
-- Adds subscription tiers (free, student, pro, team) and usage tracking for:
--   - Transcription minutes per month
--   - AI queries (chat, search, generate)
--   - Flashcard generation
--
-- This enables quota enforcement and billing integration (future: Stripe).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- SUBSCRIPTIONS — one active subscription per user
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  
  -- Tier: free, student, pro, team
  tier                    TEXT NOT NULL DEFAULT 'free'
                            CHECK (tier IN ('free', 'student', 'pro', 'team')),
  
  -- Status: active, cancelled, past_due, trialing
  status                  TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'cancelled', 'past_due', 'trialing')),
  
  -- Stripe integration (nullable until Stripe is connected)
  stripe_customer_id      TEXT UNIQUE,
  stripe_subscription_id  TEXT UNIQUE,
  
  -- Billing configuration
  billing_interval        TEXT CHECK (billing_interval IN ('monthly', 'annual')),
  current_period_start    TIMESTAMPTZ,
  current_period_end      TIMESTAMPTZ,
  price_usd               NUMERIC(10, 2),
  
  -- Student verification (.edu email check)
  edu_email_verified      BOOLEAN DEFAULT false,
  
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now(),
  
  -- Enforce one active subscription per user
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS subscriptions_user_idx 
  ON public.subscriptions(user_id);

CREATE INDEX IF NOT EXISTS subscriptions_stripe_customer_idx 
  ON public.subscriptions(stripe_customer_id) 
  WHERE stripe_customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS subscriptions_status_idx 
  ON public.subscriptions(status) 
  WHERE status != 'active';

-- ---------------------------------------------------------------------------
-- USAGE_LOGS — monthly rollup of usage metrics per user per workspace
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.usage_logs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  workspace_id          UUID REFERENCES public.workspaces(id) ON DELETE SET NULL,
  
  -- Period in YYYY-MM format (e.g., '2026-05' for May 2026)
  period                TEXT NOT NULL,
  
  -- Usage metrics tracked for quota enforcement
  transcription_minutes INTEGER DEFAULT 0,
  ai_queries_count      INTEGER DEFAULT 0,
  flashcards_generated  INTEGER DEFAULT 0,
  
  -- Cost tracking (from pipeline_logs aggregation)
  total_cost_usd        NUMERIC(10, 6) DEFAULT 0,
  
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now(),
  
  -- One row per user per workspace per month
  UNIQUE (user_id, workspace_id, period)
);

CREATE INDEX IF NOT EXISTS usage_logs_user_period_idx 
  ON public.usage_logs(user_id, period DESC);

CREATE INDEX IF NOT EXISTS usage_logs_workspace_period_idx 
  ON public.usage_logs(workspace_id, period DESC) 
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS usage_logs_period_idx 
  ON public.usage_logs(period DESC);

-- ---------------------------------------------------------------------------
-- TRIGGERS — auto-update updated_at timestamps
-- ---------------------------------------------------------------------------
CREATE TRIGGER subscriptions_set_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER usage_logs_set_updated_at
  BEFORE UPDATE ON public.usage_logs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- BACKFILL — give all existing users a free tier subscription
-- ---------------------------------------------------------------------------
INSERT INTO public.subscriptions (user_id, tier, status)
SELECT id, 'free', 'active'
FROM public.users
ON CONFLICT (user_id) DO NOTHING;

COMMIT;
