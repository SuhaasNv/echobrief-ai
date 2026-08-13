-- ============================================================================
-- EchoBrief AI — Persist the participants the model already identifies
-- Migration: 0017_summary_participants.sql
--
-- ANALYSIS_SCHEMA has required `summary.participants` since speaker naming was
-- designed, and the schema is sent with `strict: true`, so the model produces
-- the list on EVERY meeting and we pay output tokens for it. Nothing ever
-- stored it: `summaries` had no such column and the worker's INSERT names six.
-- packages/shared even declares `summary.participants` on the response type, so
-- the field is published in the API's own contract and is always absent.
--
-- The cost of that is not the tokens, it is the feature it was generated for.
-- Putting real names to diarized voices is the one place a wrong guess is worse
-- than no guess — a name attached to a decision someone did not make — which is
-- why the prompt tells the model to include a name only if it would bet on it,
-- and to return an empty array rather than guessing. The client is left running
-- a regex over the transcript for "I'm X" instead, which cannot hear what the
-- model heard.
--
-- text[] rather than jsonb: it is a flat list of short strings, every sibling
-- list on this table (key_topics, decisions, open_questions) is already text[],
-- and jsonb here would mean a different accessor for the one column that holds
-- the same shape as its neighbours.
--
-- Empty array rather than NULL as the default, for the same reason those three
-- use it: "the model found nobody" and "this row predates the column" both read
-- as no participants, and no caller has to distinguish them.
-- ============================================================================

ALTER TABLE public.summaries
  ADD COLUMN IF NOT EXISTS participants TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- No index. The column is read only alongside its own row, which is already
-- reached by the unique index on meeting_id; searching BY participant is not a
-- feature that exists, and a GIN index here would cost every analysis write to
-- support a query nothing makes.
