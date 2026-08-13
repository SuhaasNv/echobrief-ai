-- Rollback for 0014_meeting_search.sql
--
-- Drops full-text search. GET /meetings?q= must be reverted to title-only
-- ILIKE at the same time or every search request will fail on a missing
-- column — roll this back together with the route code that reads search_tsv.
--
-- Dropping the columns drops their GIN indexes with them.

ALTER TABLE public.transcripts DROP COLUMN IF EXISTS search_tsv;
ALTER TABLE public.summaries   DROP COLUMN IF EXISTS search_tsv;
ALTER TABLE public.meetings    DROP COLUMN IF EXISTS search_tsv;

-- Restore the pre-0013 expression index exactly as 0001 created it.
CREATE INDEX IF NOT EXISTS transcripts_text_idx
  ON public.transcripts USING gin(to_tsvector('english', raw_text));
