-- ============================================================================
-- EchoBrief AI — Initial Schema
-- Migration: 0001_initial_schema.sql
-- Applies to: Supabase (PostgreSQL 15+)
-- ============================================================================

-- Required extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

-- ----------------------------------------------------------------------------
-- USERS
-- Standalone identity table. The auth provider (Better Auth) maintains its
-- own session/account tables; this row mirrors the authenticated user id.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT UNIQUE NOT NULL,
  name        TEXT,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- WORKSPACES (V3)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workspaces (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  logo_url    TEXT,
  owner_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.workspace_members (
  workspace_id  UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES public.users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK (role IN ('admin','member','viewer')),
  joined_at     TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS workspace_members_user_idx
  ON public.workspace_members(user_id);

-- ----------------------------------------------------------------------------
-- MEETINGS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.meetings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  workspace_id    UUID REFERENCES public.workspaces(id) ON DELETE SET NULL,
  title           TEXT NOT NULL,
  audio_key       TEXT,
  audio_size      BIGINT,
  audio_mime      TEXT,
  duration_sec    INTEGER,
  language        TEXT DEFAULT 'en',
  status          TEXT NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued','transcribing','analyzing','indexing','complete','failed')),
  failure_reason  TEXT,
  visibility      TEXT NOT NULL DEFAULT 'private'
                  CHECK (visibility IN ('private','team')),
  share_token     TEXT UNIQUE,
  tags            TEXT[] DEFAULT ARRAY[]::TEXT[],
  meeting_score   JSONB,
  retry_count     INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now(),
  processed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS meetings_user_created_idx
  ON public.meetings(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS meetings_workspace_idx
  ON public.meetings(workspace_id) WHERE workspace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS meetings_status_idx
  ON public.meetings(status) WHERE status != 'complete';
CREATE INDEX IF NOT EXISTS meetings_tags_idx
  ON public.meetings USING gin(tags);

-- ----------------------------------------------------------------------------
-- TRANSCRIPTS (one per meeting; structured JSON from Deepgram)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.transcripts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id  UUID UNIQUE NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  raw_text    TEXT NOT NULL,
  content     JSONB NOT NULL,            -- { words[], paragraphs[], utterances[] }
  speakers    JSONB DEFAULT '[]'::JSONB, -- [{ id, label, talk_time_sec, word_count }]
  language    TEXT,
  provider    TEXT DEFAULT 'deepgram',
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transcripts_text_idx
  ON public.transcripts USING gin(to_tsvector('english', raw_text));

-- ----------------------------------------------------------------------------
-- SUMMARIES
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.summaries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id      UUID UNIQUE NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  executive       TEXT,
  key_topics      TEXT[] DEFAULT ARRAY[]::TEXT[],
  decisions       TEXT[] DEFAULT ARRAY[]::TEXT[],
  open_questions  TEXT[] DEFAULT ARRAY[]::TEXT[],
  chapters        JSONB DEFAULT '[]'::JSONB, -- [{ title, start_sec, end_sec, summary }]
  model           TEXT,
  generated_at    TIMESTAMPTZ DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- ACTION ITEMS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.action_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id      UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  description     TEXT NOT NULL,
  assignee_name   TEXT,
  assignee_id     UUID REFERENCES public.users(id) ON DELETE SET NULL,
  due_date        DATE,
  completed       BOOLEAN DEFAULT false,
  completed_at    TIMESTAMPTZ,
  timestamp_sec   INTEGER,
  export_refs     JSONB DEFAULT '{}'::JSONB, -- { notion: "...", linear: "..." }
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS action_items_user_idx
  ON public.action_items(user_id, completed, due_date);
CREATE INDEX IF NOT EXISTS action_items_meeting_idx
  ON public.action_items(meeting_id);

-- ----------------------------------------------------------------------------
-- TRANSCRIPT CHUNKS (vector search)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.transcript_chunks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id    UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  chunk_index   INTEGER NOT NULL,
  content       TEXT NOT NULL,
  start_sec     INTEGER,
  end_sec       INTEGER,
  embedding     VECTOR(1536),
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transcript_chunks_user_idx
  ON public.transcript_chunks(user_id);
CREATE INDEX IF NOT EXISTS transcript_chunks_meeting_idx
  ON public.transcript_chunks(meeting_id);
CREATE INDEX IF NOT EXISTS transcript_chunks_embedding_idx
  ON public.transcript_chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- ----------------------------------------------------------------------------
-- INTEGRATIONS (encrypted OAuth tokens)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.integrations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL CHECK (provider IN ('notion','linear','jira','google_calendar','trello')),
  workspace_name  TEXT,
  access_token    TEXT NOT NULL,    -- AES-256 encrypted; envelope { iv, ciphertext, tag }
  refresh_token   TEXT,             -- encrypted
  expires_at      TIMESTAMPTZ,
  metadata        JSONB DEFAULT '{}'::JSONB,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, provider)
);

-- ----------------------------------------------------------------------------
-- MEETING COMMENTS (V3 collaboration)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.meeting_comments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id      UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content         TEXT NOT NULL,
  range_start_sec INTEGER,
  range_end_sec   INTEGER,
  highlight       TEXT CHECK (highlight IN ('decision','risk','question','note')),
  parent_id       UUID REFERENCES public.meeting_comments(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meeting_comments_meeting_idx
  ON public.meeting_comments(meeting_id);

-- ----------------------------------------------------------------------------
-- AI PIPELINE LOGS (cost + latency telemetry)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pipeline_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id    UUID REFERENCES public.meetings(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES public.users(id) ON DELETE CASCADE,
  step          TEXT NOT NULL,
  provider      TEXT,
  model         TEXT,
  duration_ms   INTEGER,
  cost_usd      NUMERIC(10, 6),
  status        TEXT CHECK (status IN ('success','failure')),
  error         TEXT,
  metadata      JSONB DEFAULT '{}'::JSONB,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pipeline_logs_meeting_idx
  ON public.pipeline_logs(meeting_id, created_at);

-- ----------------------------------------------------------------------------
-- UPDATED_AT triggers
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER action_items_set_updated_at
  BEFORE UPDATE ON public.action_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
