-- ============================================================================
-- EchoBrief AI — When the audio was actually recorded
-- Migration: 0011_recorded_at.sql
--
-- meetings has only created_at (upload time) and processed_at. Nothing records
-- when the conversation happened. Upload Tuesday's meeting on Thursday and the
-- app dates it Thursday — and any future attempt to match a recording to a
-- calendar event would land on the wrong event, confidently.
--
-- recorded_at is NULLABLE and stays NULL when we can't determine it. The
-- client sends the file's lastModified, which for most exports is the
-- recording time — but it is a best-effort signal, not proof: re-saving or
-- copying a file rewrites it. Callers must treat NULL as "unknown" and fall
-- back to created_at rather than pretending the upload time is the meeting
-- time.
-- ============================================================================

ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS recorded_at TIMESTAMPTZ;

-- Listing and calendar-style grouping will sort on this once it is populated.
CREATE INDEX IF NOT EXISTS meetings_user_recorded_at_idx
  ON public.meetings (user_id, recorded_at DESC NULLS LAST);
