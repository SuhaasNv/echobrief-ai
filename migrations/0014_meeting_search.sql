-- ============================================================================
-- EchoBrief AI — Full-text search over meeting content
-- Migration: 0014_meeting_search.sql
--
-- GET /meetings?q= matched `title ILIKE '%q%'` and nothing else. Searching
-- "R2 credentials" returned zero results even when someone said exactly that
-- out loud, because the words a user remembers live in the transcript, not in
-- the title they typed. This migration builds the index side of real search.
--
-- WHY THREE COLUMNS INSTEAD OF ONE
--
-- The searchable text is spread across three tables — meetings.title,
-- summaries.executive, transcripts.raw_text — all 1:1 on meeting_id. A STORED
-- generated column can only read columns of its own row, so a single combined
-- meetings.search_tsv is not expressible as a generated column; it would need
-- three triggers (INSERT/UPDATE on each source table, each issuing an UPDATE
-- back into meetings) that can silently go stale the moment one path forgets
-- to fire. Transcripts and summaries are written asynchronously by the worker,
-- so a stale vector means "the meeting you just processed is unsearchable" —
-- the exact failure a user cannot diagnose or work around.
--
-- Generated columns cannot drift: Postgres recomputes them on every write of
-- the row that owns the text. The weighting the query wants (title above
-- summary above transcript) is applied here with setweight(), and the query
-- concatenates the three vectors at read time — tsvector || tsvector preserves
-- per-lexeme weights, so ts_rank_cd() over the concatenation ranks exactly as
-- it would over one combined column.
--
-- WHY THE regconfig IS PINNED
--
-- to_tsvector(text) is STABLE, not IMMUTABLE — it reads default_text_search_config
-- from the session — so a generated column rejects it. The two-argument form
-- to_tsvector('english', ...) is IMMUTABLE and is required here. It also means
-- the stored vectors are English-stemmed regardless of meetings.language; that
-- matches the existing transcripts_text_idx this migration replaces, and is a
-- deliberate follow-up, not an oversight.
--
-- WHY THE left() CAPS
--
-- to_tsvector() raises "string is too long for tsvector" above 1MB of output.
-- Inside a STORED generated column that error fires on INSERT, which would
-- make a long transcript impossible to store at all — a far worse bug than
-- weak search. Measured worst case (every token unique, 32 chars) is 614KB of
-- tsvector per 500K chars of input, so the 500K cap holds the output under the
-- limit with ~1.7x margin. 500K chars is roughly nine hours of speech; the API
-- caps a meeting at four. Text past the cap is unsearchable but still stored,
-- readable, and returned by the detail endpoint.
--
-- NOTE ON LOCKING: ADD COLUMN ... GENERATED ALWAYS AS ... STORED rewrites the
-- table under ACCESS EXCLUSIVE. At today's row counts this is seconds. See the
-- migration notes in the PR for what it costs at 100k meetings.
-- ============================================================================

-- Title: weight A. The name a user gave a meeting is the strongest signal they
-- have about which meeting they mean.
ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', left(coalesce(title, ''), 10000)), 'A')
  ) STORED;

-- Executive summary: weight B. Model-written prose about the meeting.
-- Only `executive` is included: key_topics/decisions/open_questions are TEXT[],
-- and array_to_string() is STABLE (it depends on element output functions), so
-- Postgres rejects it in a generated column.
ALTER TABLE public.summaries
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', left(coalesce(executive, ''), 100000)), 'B')
  ) STORED;

-- Transcript body: weight D, the lowest. This is the largest text by orders of
-- magnitude and the least deliberate; it should surface a meeting, not
-- dominate the ordering of one.
ALTER TABLE public.transcripts
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', left(coalesce(raw_text, ''), 500000)), 'D')
  ) STORED;

-- GIN, not GiST: this is a read-heavy corpus that is written once per meeting.
-- CONCURRENTLY is deliberately absent — the migration runner wraps each file in
-- a transaction and CREATE INDEX CONCURRENTLY cannot run inside one.
CREATE INDEX IF NOT EXISTS meetings_search_tsv_idx
  ON public.meetings USING gin(search_tsv);
CREATE INDEX IF NOT EXISTS summaries_search_tsv_idx
  ON public.summaries USING gin(search_tsv);
CREATE INDEX IF NOT EXISTS transcripts_search_tsv_idx
  ON public.transcripts USING gin(search_tsv);

-- Superseded by transcripts_search_tsv_idx. The old expression index was never
-- queried by any code path (nothing in src/ ever wrote a tsquery), and it
-- carried the uncapped to_tsvector('english', raw_text) that makes a
-- sufficiently long transcript fail to INSERT. Dropping it removes a landmine
-- and halves GIN write amplification on the transcripts table.
DROP INDEX IF EXISTS public.transcripts_text_idx;
