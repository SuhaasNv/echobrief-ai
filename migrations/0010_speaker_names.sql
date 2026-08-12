-- ============================================================================
-- EchoBrief AI — Human speaker names
-- Migration: 0010_speaker_names.sql
--
-- Diarization (AssemblyAI speaker_labels) already separates voices and tags
-- every word with a raw label — "A", "B", "C". That's accurate but anonymous:
-- the transcript reads "A: …" instead of "Maya: …".
--
-- speaker_names maps those raw labels to human names, per meeting:
--   {"A": "Maya", "B": "David"}
--
-- Per-meeting rather than per-user on purpose. AssemblyAI assigns labels
-- independently for each recording — "A" in one meeting is not the same person
-- as "A" in another — so a global mapping would confidently mislabel people.
-- Cross-meeting identity needs stored voice embeddings, which is a much larger
-- feature and deliberately out of scope here.
--
-- Empty object default means existing rows keep falling back to "Speaker A".
-- ============================================================================

ALTER TABLE public.transcripts
  ADD COLUMN IF NOT EXISTS speaker_names JSONB NOT NULL DEFAULT '{}'::jsonb;
