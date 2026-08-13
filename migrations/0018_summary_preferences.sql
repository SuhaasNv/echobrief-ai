-- ============================================================================
-- EchoBrief AI — Make the AI-output settings actually do something
-- Migration: 0018_summary_preferences.sql
--
-- The app has offered four settings for how summaries are written since the
-- settings screens were built:
--
--   Summary style   Executive brief / Detailed notes / Bullet points / Decisions only
--   Summary length  Short / Standard / Long
--   Tone            Neutral / Direct / Warm
--   Detect action items  on / off
--
-- Every one of them was inert. There was no column to hold them, the API never
-- accepted them, and the worker sent a fixed prompt regardless — so choosing
-- "Bullet points, Short, Direct" produced output byte-identical to "Detailed
-- notes, Long, Warm". They were stored on the phone, rendered as chosen, and
-- read by nothing.
--
-- That is worse than not offering the settings. A control that visibly responds
-- and changes nothing teaches the user that the app's settings are decorative,
-- and it is invisible to testing because the screen always looks correct.
--
-- WHY TEXT WITH A CHECK RATHER THAN AN ENUM
--
-- A Postgres ENUM needs ALTER TYPE to add a value, which cannot run inside the
-- same transaction as a statement that uses it — so adding a fifth summary
-- style later would be a two-deploy dance. These vocabularies are product
-- copy and will change. TEXT + CHECK gives the same integrity with an ordinary
-- ALTER, and the constraint names below say exactly what was violated.
--
-- WHY NULLABLE, WITH NO DEFAULT VALUE FOR STYLE/LENGTH/TONE
--
-- NULL means "this user has never expressed a preference", which is not the
-- same as choosing the default. The pipeline treats NULL as "write it the way
-- you would have before this migration", so every existing meeting keeps
-- producing exactly what it produced yesterday and nothing changes under a user
-- who never opened the setting. `detect_action_items` is the exception: it is a
-- boolean with no third state, and extraction has always been on.
-- ============================================================================

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS summary_style TEXT,
  ADD COLUMN IF NOT EXISTS summary_length TEXT,
  ADD COLUMN IF NOT EXISTS summary_tone TEXT,
  ADD COLUMN IF NOT EXISTS detect_action_items BOOLEAN NOT NULL DEFAULT TRUE;

-- Values mirror the unions in apps/mobile/src/components/settings/preferences.ts.
-- If you add one there, add it here in the same change or the write is rejected
-- at the database with a constraint error rather than silently stored.
ALTER TABLE public.user_preferences
  DROP CONSTRAINT IF EXISTS user_preferences_summary_style_check;
ALTER TABLE public.user_preferences
  ADD CONSTRAINT user_preferences_summary_style_check
  CHECK (summary_style IS NULL OR summary_style IN ('executive', 'detailed', 'bullets', 'decisions'));

ALTER TABLE public.user_preferences
  DROP CONSTRAINT IF EXISTS user_preferences_summary_length_check;
ALTER TABLE public.user_preferences
  ADD CONSTRAINT user_preferences_summary_length_check
  CHECK (summary_length IS NULL OR summary_length IN ('short', 'standard', 'long'));

ALTER TABLE public.user_preferences
  DROP CONSTRAINT IF EXISTS user_preferences_summary_tone_check;
ALTER TABLE public.user_preferences
  ADD CONSTRAINT user_preferences_summary_tone_check
  CHECK (summary_tone IS NULL OR summary_tone IN ('neutral', 'direct', 'warm'));

-- No index. These are read only as part of the one row already fetched by the
-- (user_id, workspace_id) primary key when a meeting is analysed.
