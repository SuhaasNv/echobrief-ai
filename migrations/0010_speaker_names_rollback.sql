-- Rollback for 0010_speaker_names.sql
--
-- Drops every human speaker name users have assigned. Transcripts fall back to
-- "Speaker A" / "Speaker B"; diarization itself is unaffected, since the raw
-- labels live in transcripts.content, not here.

ALTER TABLE public.transcripts
  DROP COLUMN IF EXISTS speaker_names;
