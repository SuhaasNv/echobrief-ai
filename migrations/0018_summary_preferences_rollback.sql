-- Rollback for 0018_summary_preferences.sql
--
-- Drops the four AI-output preferences. Every user who set one loses it and the
-- pipeline reverts to the single fixed prompt, which is exactly the behaviour
-- these columns were added to end — so rolling this back re-introduces settings
-- that render as chosen and change nothing.
--
-- Roll it back together with the code that reads it: the worker passes these
-- into the analysis prompt and the preferences endpoint returns them, so the
-- SELECT will fail on an unknown column if the code outlives the schema.

ALTER TABLE public.user_preferences
  DROP CONSTRAINT IF EXISTS user_preferences_summary_style_check,
  DROP CONSTRAINT IF EXISTS user_preferences_summary_length_check,
  DROP CONSTRAINT IF EXISTS user_preferences_summary_tone_check;

ALTER TABLE public.user_preferences
  DROP COLUMN IF EXISTS summary_style,
  DROP COLUMN IF EXISTS summary_length,
  DROP COLUMN IF EXISTS summary_tone,
  DROP COLUMN IF EXISTS detect_action_items;
