-- Rollback: 0003_vector_search_fn.sql
BEGIN;
DROP FUNCTION IF EXISTS public.search_transcript_chunks(UUID, VECTOR(1536), DOUBLE PRECISION, INT);
COMMIT;
