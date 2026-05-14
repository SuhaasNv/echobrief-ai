-- ============================================================================
-- EchoBrief AI — Vector Search RPC
-- Migration: 0003_vector_search_fn.sql
--
-- Function called from the API to do cosine-similarity search over a user's
-- transcript chunks. Returns the top-K chunks ranked by similarity.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.match_transcript_chunks(
  query_embedding VECTOR(1536),
  match_user_id   UUID,
  match_count     INTEGER DEFAULT 20,
  match_threshold REAL DEFAULT 0.5
)
RETURNS TABLE (
  id            UUID,
  meeting_id    UUID,
  meeting_title TEXT,
  content       TEXT,
  start_sec     INTEGER,
  end_sec       INTEGER,
  similarity    REAL
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.meeting_id,
    m.title AS meeting_title,
    c.content,
    c.start_sec,
    c.end_sec,
    (1 - (c.embedding <=> query_embedding))::REAL AS similarity
  FROM public.transcript_chunks c
  JOIN public.meetings m ON m.id = c.meeting_id
  WHERE c.user_id = match_user_id
    AND (1 - (c.embedding <=> query_embedding)) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- (Supabase-specific role grants removed — the app's single Postgres user
-- already has EXECUTE by default on functions in `public`.)
