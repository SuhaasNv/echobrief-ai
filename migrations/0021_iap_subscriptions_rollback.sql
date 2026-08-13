-- Rollback 0021.
--
-- Drops the IAP columns. Note this DESTROYS the record of where an entitlement
-- came from — a Pro row survives, but nothing remembers whether it was bought,
-- comped, or granted from a sandbox receipt. Only run this if 0021 is being
-- reverted before any real purchase has landed.

DROP INDEX IF EXISTS public.subscriptions_last_event_id_idx;
DROP INDEX IF EXISTS public.subscriptions_tier_status_idx;
DROP INDEX IF EXISTS public.subscriptions_user_id_key;

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_provider_check,
  DROP CONSTRAINT IF EXISTS subscriptions_environment_check;

ALTER TABLE public.subscriptions
  DROP COLUMN IF EXISTS provider,
  DROP COLUMN IF EXISTS rc_app_user_id,
  DROP COLUMN IF EXISTS store_transaction_id,
  DROP COLUMN IF EXISTS store_product_id,
  DROP COLUMN IF EXISTS auto_renew,
  DROP COLUMN IF EXISTS environment,
  DROP COLUMN IF EXISTS last_event_id,
  DROP COLUMN IF EXISTS last_event_at,
  DROP COLUMN IF EXISTS granted_by,
  DROP COLUMN IF EXISTS granted_reason;
