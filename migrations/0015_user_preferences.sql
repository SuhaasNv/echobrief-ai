-- ============================================================================
-- EchoBrief AI — Preferences that actually reach the pipeline
-- Migration: 0015_user_preferences.sql
--
-- The iOS settings screens persisted every preference to the Keychain and sent
-- none of it anywhere. Choosing a transcription language, adding vocabulary, or
-- picking a retention window changed nothing about the output; the screens said
-- so out loud ("stored on this iPhone"), which was honest but not a product.
--
-- This table holds the three preferences that have a real consumer on the
-- server today, and nothing else. A column for a setting nothing reads is the
-- same lie in a different store, so `summaryStyle`, `tone`, `audioQuality` and
-- friends are deliberately absent until something consumes them.
--
-- WHY (user_id, workspace_id) AND NOT user_id ALONE
--
-- There is no RLS on Railway; a WHERE clause is the only tenant isolation this
-- schema has, and every partitioned table in this database (meetings,
-- action_items, transcript_chunks, flashcards) is keyed by both columns. A
-- user-only key would be the one row a workspace-scoped query could not filter,
-- and it is not merely a consistency argument: vocabulary is company jargon and
-- colleague names. Someone in a client workspace and a personal one should not
-- have the client's product names boosted into personal recordings, and the
-- retention window a team agreed on should not follow the person home.
--
-- WHY EVERY SETTING COLUMN IS NULLABLE
--
-- NULL means "never chosen", and every consumer falls back to exactly the
-- behaviour that shipped before this migration. Existing users have no row at
-- all, so the fallback is what they already get. This matters most on a PATCH
-- that touches one field: adding a vocabulary term inserts a row, and if NULL
-- did not mean "unchanged" that row would silently reassign the user's
-- transcription language and audio retention as a side effect.
--
-- WHY LANGUAGE USES AN 'auto' SENTINEL RATHER THAN NULL
--
-- "Detect automatically" is a real, deliberate choice in the picker, and it is
-- a DIFFERENT instruction from "not configured": auto sends AssemblyAI
-- `language_detection`, while unconfigured keeps using the language the upload
-- request carried. Collapsing both onto NULL is what would make the side effect
-- above happen. The sentinel is ugly; a preference that changes when you edit a
-- different preference is worse.
--
-- RETENTION VALUES
--
--   NULL  → platform default (see DEFAULT_AUDIO_RETENTION_DAYS in
--           packages/shared/src/schemas.ts — the cleanup worker and the iOS
--           copy both read that constant so they cannot drift apart again)
--   0     → keep the audio until the user deletes the meeting by hand
--   N > 0 → delete the audio N days after the meeting was created
--
-- The upper bound is 365 days. It is a sanity rail on the column, not the
-- picker: the API schema owns which values a client may actually send, so
-- adding a row to the picker does not need a migration.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  -- 'auto', or a language code as AssemblyAI spells them ("en", "en_us", "pt").
  transcription_language TEXT,

  -- Terms fed to AssemblyAI `word_boost`. NOT NULL with an empty default so the
  -- worker never has to distinguish "no list" from "empty list" — both mean the
  -- transcriber gets no hints, and an empty array is the cheaper check.
  vocabulary TEXT[] NOT NULL DEFAULT '{}',

  audio_retention_days INTEGER,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (user_id, workspace_id),

  -- Loose on purpose. AssemblyAI accepts both "en" and regional forms like
  -- "en_us", and rejecting a valid code at the database layer would surface as
  -- an opaque 500 on a settings screen. The API schema does the real narrowing.
  CONSTRAINT user_preferences_language_shape CHECK (
    transcription_language IS NULL
    OR transcription_language = 'auto'
    OR transcription_language ~ '^[a-z]{2,3}(_[a-zA-Z0-9]{2,4})?$'
  ),

  -- Mirrors MAX_VOCABULARY_TERMS on iOS. AssemblyAI's own hard limit is 1000
  -- phrases (verified: a 1001-entry list returns 400 "`word_boost` list must
  -- contain no more than 1000 phrases"), so 100 leaves a wide margin while
  -- keeping the row small enough that the worker's per-meeting read stays free.
  CONSTRAINT user_preferences_vocabulary_size CHECK (
    array_length(vocabulary, 1) IS NULL OR array_length(vocabulary, 1) <= 100
  ),

  CONSTRAINT user_preferences_retention_range CHECK (
    audio_retention_days IS NULL
    OR (audio_retention_days >= 0 AND audio_retention_days <= 365)
  )
);

-- No secondary index. Both readers key on the full primary key: the API reads
-- one row by (user_id, workspace_id), and the cleanup worker LEFT JOINs
-- meetings on the same pair, which is an index lookup per meeting row rather
-- than a scan of this table.
