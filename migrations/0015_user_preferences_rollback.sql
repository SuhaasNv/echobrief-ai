-- Rollback for 0015_user_preferences.sql
--
-- Drops every stored preference. This is destructive in a way the other
-- rollbacks in this directory are not: vocabulary lists are typed by hand, one
-- term at a time, and nothing else in the database holds a copy. Dump the table
-- before running this if the intent is to roll forward again later.
--
-- Roll this back together with the code that reads it, or the API's
-- /account/preferences routes and the cleanup worker's per-user retention join
-- will fail on a missing relation. Behaviour reverts to what shipped before:
-- transcription uses the language on the upload request with no word boosting,
-- and audio is deleted at DEFAULT_AUDIO_RETENTION_DAYS flat for everyone.

DROP TABLE IF EXISTS public.user_preferences;
