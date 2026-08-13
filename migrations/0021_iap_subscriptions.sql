-- In-app purchase fields on subscriptions.
--
-- The existing columns are Stripe-named (stripe_customer_id, stripe_subscription_id)
-- and are KEPT. They cost nothing, and a web billing path through a Merchant of
-- Record may want them later. What is added is a provider discriminator plus the
-- store-side identifiers, so a row can say honestly where its entitlement came from.

ALTER TABLE public.subscriptions
  -- Defaults to 'none', deliberately, NOT 'apple'. Every row that exists today
  -- was created as a free default, not by a purchase, and must not claim to have
  -- been bought. 'none' is the truthful state for a user who has never paid.
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'none',
  -- RevenueCat App User ID. This is the app's own users.id, which is what makes
  -- restore-on-a-new-device work without a lookup table.
  ADD COLUMN IF NOT EXISTS rc_app_user_id TEXT,
  ADD COLUMN IF NOT EXISTS store_transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS store_product_id TEXT,
  ADD COLUMN IF NOT EXISTS auto_renew BOOLEAN NOT NULL DEFAULT FALSE,
  -- Sandbox and production receipts arrive at the SAME webhook URL. Storing which
  -- one produced a row is what lets the webhook refuse to let a sandbox purchase
  -- grant production entitlement — the classic IAP mistake, and free Pro for
  -- anyone who can run a StoreKit test.
  ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'production',
  -- Last webhook event applied, for idempotency and out-of-order rejection.
  ADD COLUMN IF NOT EXISTS last_event_id TEXT,
  ADD COLUMN IF NOT EXISTS last_event_at TIMESTAMPTZ,
  -- Set when an admin grants a tier by hand rather than a purchase granting it.
  -- Kept separate from `provider` so a comped account is never mistaken for
  -- revenue by the metrics query.
  ADD COLUMN IF NOT EXISTS granted_by UUID REFERENCES public.users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS granted_reason TEXT;

-- Widen the status vocabulary for the store lifecycle.
--
-- The original set was active / cancelled / past_due / trialing, which cannot
-- express what Apple actually reports. Three additions, and each distinction is
-- load-bearing for whether someone still has access:
--
--   'expired'  — period is over, NOT entitled. Distinct from 'cancelled', which
--                means auto-renew is off but the paid period is still running
--                and access must continue. Collapsing the two would cut people
--                off the moment they cancel, which is taking money for nothing.
--   'grace'    — Apple is retrying a card. Still entitled; locking someone out
--                over an expired card loses a customer who intended to pay.
--   'refunded' — money returned, entitlement ends immediately.
--
-- past_due and trialing are kept so nothing already written becomes invalid.
ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_status_check;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN ('active', 'cancelled', 'past_due', 'trialing', 'expired', 'grace', 'refunded'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_provider_check'
  ) THEN
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT subscriptions_provider_check
      CHECK (provider IN ('none', 'apple', 'stripe', 'manual'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_environment_check'
  ) THEN
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT subscriptions_environment_check
      CHECK (environment IN ('production', 'sandbox'));
  END IF;
END $$;

-- Entitlement is per user, and the webhook upsert depends on this conflict
-- target. Verified no duplicates exist before adding.
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_user_id_key
  ON public.subscriptions (user_id);

-- The admin dashboard filters by tier and status, and the revenue figure sums
-- active paid rows. Small table today, but this is the query that runs on every
-- dashboard load.
CREATE INDEX IF NOT EXISTS subscriptions_tier_status_idx
  ON public.subscriptions (tier, status);

-- Idempotency: an event already applied must be recognisable without a scan.
CREATE INDEX IF NOT EXISTS subscriptions_last_event_id_idx
  ON public.subscriptions (last_event_id)
  WHERE last_event_id IS NOT NULL;
