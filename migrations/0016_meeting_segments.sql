-- ============================================================================
-- EchoBrief AI — Crash-durable segmented recording
-- Migration: 0016_meeting_segments.sql
--
-- A meeting was captured as ONE unfinalized .m4a. An MPEG-4 container only
-- gets its `moov` atom when the recorder is stopped cleanly, so a crash, a
-- force-quit or an OS memory kill mid-meeting did not cost the tail of the
-- recording — it cost ALL of it, because the bytes on disk were unreadable
-- without the index that never got written. The file URI was then read once
-- and persisted nowhere, so there was not even a path to retry the upload.
--
-- The fix is to rotate the recorder into a fresh file every ~60 seconds and
-- upload each completed segment as it closes. This table is the server's
-- record of which pieces actually arrived. A crash now costs at most the
-- segment still being written.
--
-- WHY THE SEGMENTS MUST BE ADTS AAC, AND WHY THAT IS A SCHEMA CONCERN
--
-- Joining the pieces back into one object has to be lossless and cheap. Two
-- containers were measured against AssemblyAI end to end, byte-concatenated:
--
--   ADTS AAC  4.27s + 4.55s -> audio_duration 9, transcript contains BOTH
--   MPEG-4    4.27s + 4.55s -> audio_duration 5, transcript contains the FIRST
--
-- The MPEG-4 result is the dangerous one. It came back `status: completed`
-- with `error: null` — the second half of the meeting was silently discarded
-- and nothing anywhere reported a problem. That is a transcript with a hole in
-- it that no user and no alert could ever catch. ADTS frames are individually
-- self-describing (each carries its own sample rate and channel config), so
-- concatenation is just `cat` and the decoder keeps going.
--
-- The API therefore refuses to register a segment for any meeting whose
-- audio_mime is not a byte-concatenable container. This table stores no mime
-- of its own precisely so that rule cannot be bypassed per row: the container
-- is a property of the whole recording, it is pinned once on meetings
-- .audio_mime when the recording starts, and joining ADTS yields ADTS, so the
-- same value correctly describes the finished object too.
--
-- WHY user_id AND workspace_id ARE HERE
--
-- There is no RLS on Railway; a WHERE clause is the only tenant isolation this
-- schema has. Every partitioned table (meetings, action_items,
-- transcript_chunks, flashcards) carries both columns and every query filters
-- on both. Reaching meeting_id through a join to meetings would work right up
-- until someone writes the one query that forgets the join, and the object
-- keys in this table are a direct read path to another tenant's audio.
-- Carrying the pair makes the safe query the easy one to write.
--
-- WHY THERE IS NO `status` COLUMN
--
-- A row exists only after the server has confirmed the object in R2 with a
-- HeadObject and taken the byte count from that response rather than from the
-- client. So "registered" and "durably stored" are the same state, and a
-- status column could only ever disagree with the bucket. A segment that
-- failed to upload is represented by the absence of a row, which is exactly
-- what the gap check at finalize looks for.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.meeting_segments (
  meeting_id   UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  -- Position in the recording, 0-based and dense. Ordering is by this column
  -- and never by created_at: segments upload concurrently and a retried
  -- segment 3 routinely lands after segment 7, which would splice the meeting
  -- out of order and produce a transcript that reads as nonsense.
  "index"      INTEGER NOT NULL,

  audio_key    TEXT NOT NULL,

  -- Server-observed size, copied from the HeadObject response — never the
  -- number the client claimed. It is load-bearing, not telemetry: the worker
  -- streams the segments into a single PutObject and S3/R2 require an exact
  -- Content-Length up front, which is SUM(bytes). A wrong value here does not
  -- produce a slightly-off statistic, it aborts the upload mid-stream.
  bytes        BIGINT NOT NULL,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Doubles as the ordering index and as the idempotency key: a client that
  -- retries a register after a network timeout upserts its own row instead of
  -- creating a duplicate segment that would be spliced in twice.
  PRIMARY KEY (meeting_id, "index"),

  -- 1024 segments at the ~60s target is over 17 hours, well past the 4-hour
  -- cap the upload API enforces. This is a rail against a client stuck in a
  -- rotation loop filling the bucket, not a product limit.
  CONSTRAINT meeting_segments_index_range CHECK ("index" >= 0 AND "index" < 1024),

  -- A zero-byte object is a capture that failed silently. Rejecting it here
  -- means the gap check sees a missing segment and asks for a re-upload,
  -- instead of the join succeeding with a hole of exactly nothing in it.
  CONSTRAINT meeting_segments_bytes_positive CHECK (bytes > 0)
);

-- No secondary index, and no UNIQUE on audio_key. Every query in the codebase
-- leads with meeting_id — the worker reads one meeting's segments in index
-- order, the API counts them for one meeting, and the retention sweep joins
-- from meetings — so the primary key answers all of them. audio_key is minted
-- server-side from (user_id, meeting_id, index) and is therefore already
-- functionally determined by the primary key; a unique index on it would cost
-- a write on every segment to enforce something that cannot be violated.
