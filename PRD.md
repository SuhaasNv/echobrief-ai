# EchoBrief AI — Product Requirements Document

**Version:** 1.0  
**Author:** Suhaas NV  
**Last Updated:** 2026-05-14  
**Status:** Active

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Target Users](#3-target-users)
4. [Goals & Success Metrics](#4-goals--success-metrics)
5. [Product Scope & Phasing](#5-product-scope--phasing)
6. [Feature Specifications](#6-feature-specifications)
   - [V1 — Core Intelligence](#v1--core-intelligence)
   - [V2 — Memory & Integrations](#v2--memory--integrations)
   - [V3 — Real-Time & Team Scale](#v3--real-time--team-scale)
7. [User Flows](#7-user-flows)
8. [Technical Architecture](#8-technical-architecture)
9. [Data Models](#9-data-models)
10. [API Design](#10-api-design)
11. [AI Pipeline Design](#11-ai-pipeline-design)
12. [Non-Functional Requirements](#12-non-functional-requirements)
13. [Risks & Mitigations](#13-risks--mitigations)
14. [Open Questions](#14-open-questions)

---

## 1. Executive Summary

EchoBrief is an AI meeting intelligence platform that transforms unstructured audio into structured, searchable, actionable knowledge. Unlike basic transcription tools, EchoBrief positions itself as an **organizational memory system** — every meeting becomes a queryable knowledge artifact that teams can search, act on, and build from.

**Core value proposition:** Upload any audio → get a transcript, AI summary, extracted action items, and a ChatGPT-style interface to query the meeting's content — instantly.

**Strategic differentiation:**
- Not a transcription tool. A knowledge system.
- The killer feature: ask natural-language questions about any meeting, ever.
- Built for professional teams who have too many meetings and too little recall.

---

## 2. Problem Statement

### The Gap

Knowledge workers spend an average of 21.5 hours per week in meetings (2025 data). Of that time:
- **~30%** of decisions made in meetings are forgotten within a week
- **~60%** of action items from meetings go untracked
- There is no searchable, queryable record of what was decided and why

### What Exists Today

| Tool | What it does | What it misses |
|------|-------------|----------------|
| Otter.ai | Transcription + basic summary | No queryable AI, no action intelligence |
| Fireflies.ai | Transcription + CRM sync | Expensive, no semantic search |
| Notion AI | Notes + AI assist | Not meeting-native, no audio |
| Rev.com | High-accuracy transcription | No intelligence layer |

### The Opportunity

None of these products treat meetings as **long-term organizational memory**. They generate artifacts and stop there. EchoBrief goes further: every meeting becomes a queryable node in a persistent knowledge graph. A user can ask "What did we decide about the API architecture in Q1?" — and get an answer sourced from specific timestamps across multiple meetings.

---

## 3. Target Users

### Primary Persona — The Overloaded PM

**Name:** Maya, 28, Product Manager at a 40-person startup  
**Pain:** 8 meetings per day. Takes notes during some, loses context from others. Action items fall through the cracks. Her team uses Notion for docs but nothing captures meeting decisions.  
**Jobs to be done:**
- Capture what was decided without being the designated note-taker
- Know who owns what after a meeting ends
- Be able to answer "wait, didn't we discuss this?" when it comes up again

**Willingness to pay:** $20–40/month personal, $15–25/user/month team

---

### Secondary Persona — The Remote Engineer

**Name:** Dev, 25, Senior SWE at a distributed team  
**Pain:** Joins 4 standups, 2 planning sessions, and 1 incident debrief per week across 3 time zones. Misses context constantly.  
**Jobs to be done:**
- Catch up on meetings he missed asynchronously
- Know exactly what technical decisions were made without reading 200-line transcripts
- Find the exact moment someone explained a system design choice

**Willingness to pay:** Part of team plan; won't pay individually

---

### Tertiary Persona — The Founder/Executive

**Name:** Alex, 34, Co-founder, 12-person startup  
**Pain:** Every conversation with investors, advisors, customers has context that gets lost. Wants to know what his team committed to.  
**Jobs to be done:**
- "What did we tell the investor last month?"
- "What did the customer say their main complaint was?"
- Weekly brief from all team calls without reading anything

**Willingness to pay:** $50–100/month for full team

---

## 4. Goals & Success Metrics

### V1 Goals (0–3 months post-launch)

| Goal | Metric | Target |
|------|--------|--------|
| Users can successfully process audio | Upload-to-transcript success rate | ≥ 95% |
| AI output is useful | Summary accuracy rating (1–5) | ≥ 4.0 avg |
| Action items are extracted correctly | Precision of extracted tasks | ≥ 80% |
| Time to value | Time from upload to full results | ≤ 90 seconds for 1hr audio |
| Retention signal | % users returning within 7 days | ≥ 40% |

### V2 Goals (3–6 months)

| Goal | Metric | Target |
|------|--------|--------|
| Q&A is accurate | Answer relevance rating | ≥ 4.2 avg |
| Search is used | % sessions that use search | ≥ 30% |
| Integration adoption | % users with ≥ 1 integration connected | ≥ 25% |

### V3 Goals (6–12 months)

| Goal | Metric | Target |
|------|--------|--------|
| Team adoption | Avg team size on paid plans | ≥ 4 users |
| Retention | Monthly churn | ≤ 5% |
| Real-time usage | % meetings using live mode | ≥ 20% |

---

## 5. Product Scope & Phasing

```
V1: Core Intelligence          V2: Memory & Integrations       V3: Real-Time & Team Scale
─────────────────────          ─────────────────────────       ──────────────────────────
Auth (Supabase)                Meeting Q&A (vector search)     Live transcription
Audio upload + processing      Cross-meeting semantic search   Real-time action items
Speech-to-text (AssemblyAI)    Speaker diarization             AI meeting copilot
Transcript + summary           Notion / Jira / Linear export   Team workspaces
Action item extraction         AI email generator              Collaboration (comments)
Meeting detail page            Meeting score analytics         Multi-language support
Dashboard                      Smart timeline view             Enterprise SSO
                               Bulk search ("ask anything")    Usage analytics
```

**V1 is the line.** Nothing ships to users until V1 is fully functional end-to-end with real data.

---

## 6. Feature Specifications

---

### V1 — Core Intelligence

---

#### F-01: Authentication

**User story:** As a new user, I can sign up and log in so that my meetings are private and tied to my account.

**Acceptance criteria:**
- Google OAuth sign-in works
- Email + password signup works with email verification
- Session persists across browser restarts
- Unauthenticated users are redirected to `/login` from any `/app/*` route
- Password reset flow works end-to-end

**Technical notes:**
- Supabase Auth (handles OAuth, sessions, JWT)
- JWT stored in httpOnly cookie (not localStorage)
- TanStack Router: protect all `/app` routes via a `beforeLoad` guard in `src/routes/app/route.tsx`

---

#### F-02: Audio Upload

**User story:** As a user, I can upload an audio file so that EchoBrief can process it.

**Accepted formats:** MP3, WAV, M4A, MP4 (audio only), WEBM  
**Max file size:** 500MB  
**Max duration:** 4 hours

**Acceptance criteria:**
- Drag-and-drop and click-to-browse both work
- File type validation happens before upload starts (client + server)
- Upload progress is shown in real-time (percentage)
- Large files are chunked (5MB chunks) to handle unstable connections
- On upload failure, the user sees a specific error message (not "something went wrong")
- After upload, user is taken to a processing status page
- User receives email notification when processing completes

**Technical notes:**
- Upload directly to Cloudflare R2 (presigned URL flow — never proxy file through app server)
- Chunked upload via tus protocol or Cloudflare's multipart API
- Job ID returned on upload; polling via TanStack Query to check processing status
- File stored at: `r2://echobrief/{user_id}/{meeting_id}/audio.{ext}`

---

#### F-03: Speech-to-Text Pipeline

**User story:** As the system, when a file is uploaded, I should transcribe it accurately so that all downstream AI features work.

**Acceptance criteria:**
- Transcription starts automatically after upload completes
- Word-level timestamps are captured (needed for timeline feature in V2)
- Transcript is stored as structured JSON (segments with start/end times)
- Processing status updates in real-time (queued → transcribing → analyzing → done)
- If transcription fails, user is notified with option to retry

**Technical notes:**
- **Provider:** AssemblyAI with "universal" speech model (best latency/accuracy tradeoff)
- **Fallback:** OpenAI Whisper (self-hosted or API) if AssemblyAI fails
- Worker pattern: `processing` job
- Worker pulls job, calls AssemblyAI, stores structured transcript to PostgreSQL
- AssemblyAI response shape:
```json
{
  "words": [{ "word": "hello", "start": 0.0, "end": 0.4, "confidence": 0.99 }],
  "paragraphs": [{ "sentences": [...], "start": 0.0, "end": 15.2 }]
}
```

---

#### F-04: AI Analysis (Summary + Action Items)

**User story:** As a user, after my meeting is transcribed, I want an AI-generated summary and list of action items so I don't have to read the full transcript.

**Summary format:**
- 3–5 sentence executive summary
- Key discussion topics (bulleted, max 5)
- Decisions made (bulleted)
- Open questions / blockers

**Action item format:**
- Task description
- Assignee (extracted from context if mentioned)
- Deadline (extracted or null)
- Source: which part of the meeting it came from (timestamp)

**Acceptance criteria:**
- Summary generated within 30 seconds of transcript completion
- Action items are distinct (no duplicates), actionable (not vague)
- Each action item links to the transcript timestamp where it was mentioned
- User can mark action items complete, edit description, reassign owner

**Technical notes:**
- **Model:** OpenAI GPT-5 (cost-effective for batch analysis with structured outputs via json_schema mode)
- **Prompt:** structured JSON output via tool_use (Anthropic tool calling), not freeform text
- Summary prompt: feed full transcript in chunks (handle >100k token meetings via map-reduce)
- For meetings > 30 minutes: summarize in 10-minute chunks, then synthesize
- Store raw AI response alongside parsed output for debugging

---

#### F-05: Meeting Detail Page

**User story:** As a user, I can open any meeting and see its transcript, summary, and action items in a clean, readable interface.

**Layout:**
```
┌─────────────────────────────────────────────┐
│  Meeting Title · Date · Duration · Tags     │
├────────────────┬────────────────────────────┤
│                │  [Summary]                 │
│  Transcript    │  [Action Items]            │
│  (scrollable,  │  [Key Topics]             │
│   timestamped) │  [Ask AI] ← F-07          │
│                │                            │
└────────────────┴────────────────────────────┘
```

**Acceptance criteria:**
- Transcript is searchable (Cmd+F style in-page search)
- Clicking a timestamp seeks the audio player to that point (if audio still available)
- Summary section is copyable with one click
- Action items can be checked off inline
- Tags are editable
- Page is shareable via public link (optional, user-toggled)

---

#### F-06: Dashboard

**User story:** As a user, I can see an overview of my recent activity so I know what I've processed and what needs my attention.

**Panels:**
1. **Stats bar:** Total meetings, hours transcribed, open action items, this week's processing
2. **Recent meetings:** Last 5, with status chip and quick action
3. **Pending action items:** Overdue + due-soon items sorted by urgency
4. **Activity chart:** Meetings per day (last 30 days) — uses Recharts

**Acceptance criteria:**
- Dashboard loads within 1 second (data fetched server-side via TanStack Start loaders)
- Empty states are informative, not blank (guide user to upload their first meeting)

---

#### F-07: Per-Meeting AI Q&A

**User story:** As a user, I can ask natural language questions about a specific meeting and get sourced answers.

**Example queries:**
- "What did we decide about the launch date?"
- "Who is responsible for the API migration?"
- "What were the main concerns raised?"

**Answer format:**
- Direct answer (2–4 sentences)
- Source quotes from transcript (with timestamps)
- Confidence signal (if low confidence, say so)

**Acceptance criteria:**
- Response streams in real-time (no waiting for full answer)
- Answers include clickable timestamp references
- System prompt is grounded only in the meeting transcript (no hallucination from training data)
- User can ask follow-up questions in the same thread

**Technical notes:**
- **Model:** OpenAI GPT-5 with streaming (`stream=true`)
- System prompt includes full transcript (chunked for long meetings)
- Long meetings (>1hr): use retrieval — embed transcript chunks, retrieve top-K, pass to GPT-5
- Conversation history maintained in React state (not persisted to DB in V1)

---

### V2 — Memory & Integrations

---

#### F-08: Cross-Meeting Semantic Search ("Ask Anything")

**User story:** As a user, I can ask questions across ALL my meetings and get sourced answers, making my meeting history a searchable knowledge base.

**Example queries:**
- "Did we ever decide on a pricing model?"
- "Find all times we discussed the AWS migration"
- "What did customers complain about in sales calls?"

**Acceptance criteria:**
- Search queries all meetings in user's account (not just one)
- Results ranked by semantic relevance, not just keyword match
- Each result shows the meeting name, date, and relevant excerpt
- Clicking a result opens the meeting at the relevant timestamp
- Results load within 3 seconds

**Technical notes:**
- Embed all transcript chunks at ingest time using `text-embedding-3-small` (OpenAI) or Cohere embeddings
- Store vectors in **pgvector** (PostgreSQL extension) — collocated with main DB
- Query flow: embed the user query → cosine similarity search → retrieve top 20 chunks → re-rank → pass to GPT-5 with context
- Chunk size: ~200 words with 50-word overlap

---

#### F-09: Speaker Diarization

**User story:** As a user, I want the transcript to attribute each line to the correct speaker so I can understand who said what.

**Acceptance criteria:**
- Speaker labels appear in transcript ("Speaker 1", "Speaker 2")
- Users can rename speakers ("Speaker 1" → "Maya")
- Speaker names persist across meetings if same speaker detected
- Per-speaker stats shown on meeting detail page (talk time, word count)

**Technical notes:**
- AssemblyAI supports diarization natively via speaker labels in the Universal model
- Speaker identity matching across meetings: store speaker embeddings, cosine-compare on new meetings

---

#### F-10: Action Item Integrations

**User story:** As a user, I can export extracted action items to Notion, Jira, Linear, or Google Calendar with one click.

**Integrations priority:** Notion > Linear > Google Calendar > Jira > Trello

**Acceptance criteria:**
- OAuth connection flow for each integration (connect once, use forever)
- User selects which action items to export before exporting
- Export maps: assignee → user in destination tool, deadline → due date, description → task title
- Success/failure feedback shown inline
- User can see which items have already been exported (and to where)

**Technical notes:**
- Notion API: create a database entry per action item
- Linear API: create an issue
- Google Calendar: create event with attendees
- Store integration tokens encrypted in DB (AES-256, key in Cloudflare secrets)

---

#### F-11: AI Email Generator

**User story:** As a user, after a meeting I can generate a follow-up email with a single click.

**Email types:**
- Meeting recap (for all attendees)
- Stakeholder update (executive summary only)
- Sprint summary (engineering-focused)
- Action item assignment (individual DMs to assignees)

**Acceptance criteria:**
- User selects email type and can edit before copying/sending
- Email references real names, dates, and decisions from the meeting
- Tone is professional and specific (not generic AI fluff)

**Technical notes:**
- GPT-5 prompt includes summary + action items + participant names
- Output via streaming into an editable textarea

---

#### F-12: Smart Timeline / Chapter View

**User story:** As a user, instead of reading a raw transcript, I can see the meeting broken into chapters by topic so I can navigate directly to what I care about.

**Acceptance criteria:**
- Chapters are auto-generated (AI segments by topic shift)
- Each chapter shows: topic title, time range, 1-sentence summary
- Clicking a chapter jumps transcript to that point
- Chapter titles are editable by the user

**Technical notes:**
- AI-generated chapters via GPT-5: segment transcript into logical topic blocks
- Prompt: "Given this transcript, identify 5–10 topic segments with titles and time ranges"
- Structured JSON output via tool_use

---

#### F-13: Meeting Score (Analytics)

**User story:** As a user, I can see an AI-generated effectiveness score for each meeting so I can understand meeting quality over time.

**Score components (weighted):**
- Participation balance: are multiple speakers contributing? (25%)
- Actionability: were clear next steps defined? (25%)
- Focus: did the meeting stay on topic? (20%)
- Clarity: was communication clear and direct? (15%)
- Time efficiency: did the meeting end on time? (15%)

**Acceptance criteria:**
- Score shown as a number (e.g. 7.4/10) with sub-scores
- Score explained in 2–3 sentences
- Trend chart on dashboard: average score over last 30 days

---

### V3 — Real-Time & Team Scale

---

#### F-14: Live Transcription (Real-Time Mode)

**User story:** As a user running a meeting, I can get a live transcript and live action item suggestions as the meeting happens.

**Acceptance criteria:**
- Works via browser tab (no install required)
- Latency < 2 seconds for transcript updates
- Live action items appear in sidebar as detected
- Recording auto-saved on session end

**Technical notes:**
- WebSocket connection for streaming audio to AssemblyAI Streaming API
- Action item detection: run GPT-5-mini on rolling 30-second windows
- Store session data to same pipeline as uploaded audio on completion

---

#### F-15: Team Workspaces

**User story:** As a team admin, I can invite teammates so we can share, collaborate on, and search across all our team's meetings.

**Acceptance criteria:**
- Workspace creation: name, logo, invite via email
- Role-based access: Admin (full control), Member (can upload + view), Viewer (read-only)
- Meetings can be marked Private (only owner) or Team (all workspace members)
- Shared Q&A: ask questions across the entire team's meeting library
- Admin can see usage dashboard (seats, hours processed, cost)

---

#### F-16: Transcript Collaboration

**User story:** As a team member, I can leave comments and highlights on transcript sections so we can annotate meetings together.

**Acceptance criteria:**
- Select text in transcript → add comment
- Tag a teammate in a comment (@mention)
- Highlight sections in different colors (decision, risk, question)
- Comments visible to all workspace members with access
- Email notification on comment mention

---

## 7. User Flows

### Primary Flow: Upload → Insights

```
User lands on /app/upload
    ↓
Drag-drops audio file
    ↓
Client validates: format, size
    ↓
Request presigned R2 URL from API
    ↓
Upload file directly to R2 (chunked, with progress bar)
    ↓
API creates meeting record (status: queued)
    ↓
Job pushed to processing queue
    ↓
User sees: "Processing your meeting..."
    ↓ (polling every 5s)
Worker: AssemblyAI transcription (status: transcribing)
    ↓
Worker: GPT-5 analysis (status: analyzing)
    ↓
Worker: Vector embedding (status: indexing)
    ↓
Meeting ready (status: complete)
    ↓
User redirected to /app/meetings/:id
    ↓
Full transcript + summary + action items visible
```

### Secondary Flow: Ask Anything

```
User opens /app/chat
    ↓
Types: "Did we ever decide on the API auth approach?"
    ↓
Query embedded → vector similarity search (pgvector)
    ↓
Top 20 chunks retrieved across all meetings
    ↓
Chunks + query sent to GPT-5 with RAG prompt
    ↓
Answer streams in with source citations
    ↓
User clicks citation → opens meeting at timestamp
```

---

## 8. Technical Architecture

### System Overview

```
                    ┌─────────────────┐
                    │   Browser       │
                    │  TanStack Start │
                    │  (React 19)     │
                    └────────┬────────┘
                             │ HTTPS
              ┌──────────────▼──────────────┐
              │     Cloudflare Workers       │
              │     (SSR + API Routes)       │
              └──────┬───────────┬──────────┘
                     │           │
          ┌──────────▼──┐   ┌───▼──────────────┐
          │  PostgreSQL  │   │  Cloudflare R2   │
          │  (Supabase)  │   │  (Audio Storage) │
          │  + pgvector  │   └──────────────────┘
          └──────┬───────┘
                 │
     ┌───────────▼───────────┐
     │   Job Queue            │
     │   (Cloudflare Queues)  │
     └───────────┬────────────┘
                 │
     ┌───────────▼───────────┐
     │   AI Worker            │
     │   (Cloudflare Worker)  │
     │                        │
│  AssemblyAI (STT)      │
│  OpenAI API (Analysis) │
     │  OpenAI Embeddings     │
     └────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Technology |
|-----------|---------------|------------|
| Frontend | UI, routing, data display | TanStack Start + React 19 |
| API Layer | Auth, REST endpoints, job dispatch | Cloudflare Workers (Hono.js) |
| Audio Storage | Raw audio files | Cloudflare R2 |
| Database | Meetings, transcripts, users, vectors | PostgreSQL (Supabase) + pgvector |
| Job Queue | Async processing pipeline | Cloudflare Queues |
| AI Worker | STT + analysis + embeddings | Cloudflare Workers |
| Cache | Session cache, rate limiting | Cloudflare KV |

### Why This Stack

- **Cloudflare Workers (API + SSR):** Edge-first, zero cold starts, global distribution, integrated with R2/KV/Queues
- **Supabase PostgreSQL:** Managed Postgres + pgvector + Auth + real-time subscriptions in one service
- **pgvector over Pinecone:** Avoids a second vendor; vector search + relational queries in one DB = simpler queries, no sync issues
- **AssemblyAI over Whisper:** 3–5x faster, cheaper at scale, better diarization, streaming support for V3 live mode with Universal model
- **OpenAI GPT-5 for analysis:** Best reasoning quality for meeting context; structured JSON output via json_schema strict mode ensures deterministic, type-safe outputs that match our TypeScript schemas exactly
- **Hono.js:** Lightweight, fast, Cloudflare-native router for the API layer

---

## 9. Data Models

### Users
```sql
CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT UNIQUE NOT NULL,
  name        TEXT,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

### Workspaces (V3)
```sql
CREATE TABLE workspaces (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  owner_id    UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE workspace_members (
  workspace_id  UUID REFERENCES workspaces(id),
  user_id       UUID REFERENCES users(id),
  role          TEXT CHECK (role IN ('admin', 'member', 'viewer')),
  PRIMARY KEY (workspace_id, user_id)
);
```

### Meetings
```sql
CREATE TABLE meetings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) NOT NULL,
  workspace_id    UUID REFERENCES workspaces(id),
  title           TEXT NOT NULL,
  audio_url       TEXT,              -- R2 object key
  duration_sec    INTEGER,
  status          TEXT CHECK (status IN ('queued','transcribing','analyzing','indexing','complete','failed')),
  visibility      TEXT CHECK (visibility IN ('private','team')) DEFAULT 'private',
  tags            TEXT[],
  meeting_score   JSONB,             -- { total: 7.4, participation: 8, actionability: 7, ... }
  created_at      TIMESTAMPTZ DEFAULT now(),
  processed_at    TIMESTAMPTZ
);
```

### Transcripts
```sql
CREATE TABLE transcripts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id  UUID REFERENCES meetings(id) ON DELETE CASCADE,
  content     JSONB NOT NULL,   -- { words: [...], segments: [...], paragraphs: [...] }
  raw_text    TEXT NOT NULL,    -- full plain text for display
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

### Summaries
```sql
CREATE TABLE summaries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id      UUID REFERENCES meetings(id) ON DELETE CASCADE,
  executive       TEXT,          -- 3-5 sentence summary
  key_topics      TEXT[],
  decisions       TEXT[],
  open_questions  TEXT[],
  chapters        JSONB,         -- [{ title, start_sec, end_sec, summary }]
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

### Action Items
```sql
CREATE TABLE action_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id    UUID REFERENCES meetings(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES users(id),
  description   TEXT NOT NULL,
  assignee_name TEXT,
  assignee_id   UUID REFERENCES users(id),
  due_date      DATE,
  completed     BOOLEAN DEFAULT false,
  timestamp_sec INTEGER,         -- where in the meeting this was mentioned
  export_refs   JSONB,           -- { notion: "page_id", linear: "issue_id" }
  created_at    TIMESTAMPTZ DEFAULT now()
);
```

### Transcript Chunks (Vector Search)
```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE transcript_chunks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id  UUID REFERENCES meetings(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id),
  chunk_index INTEGER NOT NULL,
  content     TEXT NOT NULL,
  start_sec   INTEGER,
  end_sec     INTEGER,
  embedding   VECTOR(1536),      -- text-embedding-3-small dimensions
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX ON transcript_chunks 
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
```

---

## 10. API Design

All endpoints are under `/api/v1`. Auth via Bearer JWT (Supabase JWT).

### Meetings

```
POST   /api/v1/meetings/upload-url     → get presigned R2 URL
POST   /api/v1/meetings                → create meeting record after upload
GET    /api/v1/meetings                → list user's meetings (paginated)
GET    /api/v1/meetings/:id            → single meeting with transcript + summary
DELETE /api/v1/meetings/:id            → delete meeting + R2 object
PATCH  /api/v1/meetings/:id            → update title, tags, visibility
GET    /api/v1/meetings/:id/status     → polling endpoint for processing status
```

### Action Items

```
GET    /api/v1/action-items            → all items for user (filterable by meeting, status)
PATCH  /api/v1/action-items/:id        → update (complete, reassign, edit)
POST   /api/v1/action-items/:id/export → export to Notion/Linear/etc
```

### AI Endpoints

```
POST   /api/v1/meetings/:id/chat       → streaming Q&A for a single meeting
POST   /api/v1/search                  → cross-meeting semantic search
POST   /api/v1/generate/email          → generate follow-up email for a meeting
```

### Integrations

```
GET    /api/v1/integrations            → list connected integrations
POST   /api/v1/integrations/:provider/connect  → initiate OAuth
GET    /api/v1/integrations/:provider/callback → OAuth callback
DELETE /api/v1/integrations/:provider  → disconnect
```

### Upload Flow (Presigned URL)

```
1. Client: POST /api/v1/meetings/upload-url { filename, content_type, size }
2. Server: validate + generate R2 presigned PUT URL (TTL: 1 hour)
3. Server: create meeting record with status=queued, return { upload_url, meeting_id }
4. Client: PUT {upload_url} with file binary (direct to R2, no server proxy)
5. Client: POST /api/v1/meetings { meeting_id } to trigger processing
6. Server: push job to Cloudflare Queue
7. Client: poll GET /api/v1/meetings/:id/status every 5 seconds
```

---

## 11. AI Pipeline Design

### Processing Pipeline (per meeting)

```
Step 1: Transcription (AssemblyAI)
─────────────────────────────────
Input:  R2 audio URL
Config: model=nova-3, diarize=true, smart_format=true, paragraphs=true, utterances=true
Output: { words[], paragraphs[], utterances[] }
Store:  transcripts table (JSONB)
Time:   ~2–5 min for 1hr audio

Step 2: Summary Generation (OpenAI GPT-5)
───────────────────────────────────────────────
Input:  Full transcript text
Method: tool_use with structured JSON schema
Output: { executive, key_topics[], decisions[], open_questions[], chapters[] }
Store:  summaries table
Time:   ~15–30 seconds

For meetings > 90 minutes:
  - Chunk transcript into 10-minute windows
  - Summarize each chunk independently
  - Synthesize chunk summaries into final summary (map-reduce)

Step 3: Action Item Extraction (OpenAI GPT-5)
──────────────────────────────────────────────────
Input:  Full transcript + speaker names (if known)
Prompt: Extract tasks with owner, deadline, source timestamp
Method: tool_use (structured array output)
Output: action_items[]
Store:  action_items table
Time:   ~10–20 seconds (often batched with Step 2 in same API call)

Step 4: Vector Embedding (OpenAI text-embedding-3-small)
─────────────────────────────────────────────────────────
Input:  Transcript split into chunks (200 words, 50-word overlap)
Output: 1536-dimensional embedding per chunk
Store:  transcript_chunks table (pgvector)
Time:   ~5–10 seconds (batched API call)

Step 5: Meeting Score (OpenAI GPT-5-mini — cost-optimized)
──────────────────────────────────────────────────────────
Input:  Transcript + speaker stats + action items
Output: { total, participation, actionability, focus, clarity, efficiency, explanation }
Store:  meetings.meeting_score (JSONB)
Time:   ~5 seconds
```

### RAG Query Pipeline (F-08: Cross-Meeting Search)

```
User query: "What did we decide about pricing?"

1. Embed query: OpenAI text-embedding-3-small → 1536d vector

2. Similarity search:
   SELECT c.*, m.title, m.created_at
   FROM transcript_chunks c
   JOIN meetings m ON c.meeting_id = m.id
   WHERE c.user_id = $user_id
   ORDER BY c.embedding <=> $query_embedding
   LIMIT 20;

3. Re-rank: GPT-5-mini re-ranks top 20 by relevance (optional, adds ~1s)

4. Generate answer: GPT-5 with RAG prompt
   System: "Answer using only the provided context. Cite sources."
   User: { query, context_chunks }

5. Stream response to client with citations
```

### Cost Estimates (per 1-hour meeting)

| Step | Provider | Cost |
|------|----------|------|
| Transcription | AssemblyAI Universal | ~$0.10-0.15 |
| Summary + Action Items | OpenAI GPT-5 (1 call, structured) | ~$0.12 |
| Embeddings (100 chunks) | OpenAI text-embedding-3-small | ~$0.002 |
| Meeting Score | OpenAI GPT-5-mini | ~$0.01 |
| **Total per meeting** | | **~$0.23** |

At a $20/month plan with 30 meetings/month → COGS = ~$7/user/month → ~65% gross margin (target).

---

## 12. Non-Functional Requirements

### Performance
- **Time to first transcript:** ≤ 5 minutes for 1-hour audio
- **Dashboard load:** ≤ 1 second (SSR with data loaders)
- **Chat response first token:** ≤ 1 second (streaming)
- **Semantic search latency:** ≤ 3 seconds for queries across 1,000 meetings

### Reliability
- **Pipeline success rate:** ≥ 99% (with retry logic and fallback providers)
- **API uptime:** ≥ 99.9% (Cloudflare Workers SLA)
- **Job retry policy:** exponential backoff, max 3 retries, dead-letter queue for failed jobs

### Security
- Audio files stored in private R2 bucket, only accessible via short-lived presigned URLs
- JWTs validated on every API request (Supabase JWT verification middleware)
- Integration OAuth tokens encrypted at rest (AES-256)
- Row-level security on all PostgreSQL tables (users can only query their own data)
- No audio files cached on CDN
- GDPR: user data deletion endpoint removes all meetings, transcripts, embeddings, audio

### Scalability
- Cloudflare Workers: scales to 0, no cold starts, globally distributed
- PostgreSQL: Supabase handles connection pooling (PgBouncer)
- pgvector with IVFFlat index: handles up to ~1M vectors per user efficiently
- R2: no egress fees, unlimited storage

### Accessibility
- WCAG 2.1 AA compliance
- All interactive elements keyboard-navigable
- `prefers-reduced-motion` respected in all animations
- Screen reader tested (nvda + VoiceOver)

---

## 13. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| AssemblyAI accuracy poor for non-English or accented speech | Medium | High | Allow user to correct transcript inline; add language selection via API parameter |
| OpenAI API rate limits during processing spikes | Low | Medium | Queue-based architecture absorbs spikes; implement exponential backoff with retries |
| Vector search quality poor for short meetings | Medium | Medium | Fall back to full-text search (PostgreSQL `tsvector`) if meeting < 5 minutes |
| R2 presigned URL expiry before large file upload completes | Low | Medium | Generate URL with 2-hour TTL; implement resumable upload |
| AI hallucination in meeting Q&A | Medium | High | Ground prompt with explicit transcript context; add "I don't know" escape hatch; display source quotes |
| Cost overrun from heavy processing users | Medium | Medium | Rate limiting per plan tier; processing caps; alert on unusual usage |
| Supabase pgvector performance at scale | Low | Medium | Tune IVFFlat list count; evaluate migration to dedicated vector DB if needed |

---

## 14. Open Questions

| Question | Owner | Target Resolution |
|----------|-------|------------------|
| Should YouTube URL support be in V1 or V2? (requires yt-dlp or third-party extraction) | Suhaas | V1 planning |
| Should speaker names persist across meetings automatically, or require manual confirmation? | Suhaas | V2 design |
| What is the retention policy for audio files? (Storage cost grows fast) | Suhaas | Before V1 launch |
| Should the AI Q&A conversation history be persisted to DB? | Suhaas | V1 design |
| Multi-tenancy model: is V3 workspace the unit of billing, or individual users? | Suhaas | V3 planning |
| How do we handle meeting recordings that contain PII (HR conversations, legal calls)? | Suhaas | Before V1 launch |
