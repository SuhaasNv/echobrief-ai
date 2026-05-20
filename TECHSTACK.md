# EchoBrief AI — Tech Stack Document

**Version:** 1.0  
**Author:** Suhaas NV  
**Last Updated:** 2026-05-14  
**Status:** Active

---

## Table of Contents

1. [Overview](#1-overview)
2. [Frontend](#2-frontend)
3. [Backend & API Layer](#3-backend--api-layer)
4. [AI & ML Stack](#4-ai--ml-stack)
5. [Data Layer](#5-data-layer)
6. [Infrastructure & Deployment](#6-infrastructure--deployment)
7. [Auth & Security](#7-auth--security)
8. [Integrations](#8-integrations)
9. [Observability](#9-observability)
10. [Developer Tooling](#10-developer-tooling)
11. [Decision Log](#11-decision-log)
12. [Dependency Map](#12-dependency-map)

---

## 1. Overview

EchoBrief runs on a fully edge-native stack. The guiding principles behind every choice:

- **Edge-first over server-first.** Global latency matters for a tool people open during or right after meetings. Cloudflare Workers over traditional Node servers.
- **Managed over self-hosted.** Supabase, Deepgram, and Cloudflare manage the hard infrastructure. We own the product logic, not the ops burden.
- **AI as infrastructure, not magic.** Every AI call has a fallback, a cost estimate, and a failure mode. Treat LLMs like any other external API.
- **Collocated data.** Vector search lives in the same PostgreSQL instance as relational data (pgvector). No separate vector DB = no sync issues, simpler queries.
- **One language.** TypeScript end-to-end (frontend, backend, workers). One type system, one toolchain.

---

## 2. Frontend

### Core Framework

| Technology | Version | Role |
|-----------|---------|------|
| React | 19.2 | UI rendering |
| TypeScript | 5.8 | Type safety across all code |
| TanStack Start | 1.x | Meta-framework: SSR, routing, data loading |
| TanStack Router | 1.x | File-based routing with type-safe links |
| TanStack Query | 5.x | Server state management, caching, background refetch |

**Why TanStack Start over Next.js:**  
TanStack Start is Cloudflare Workers-native. Next.js requires either Vercel or significant adapter work for edge deployment. TanStack Start ships a single Worker with SSR + API routes collocated — no separate deployment targets. File-based routing is equivalent in DX.

**Why React 19:**  
React 19 ships concurrent features and improved `use()` hook for async data. TanStack Start is built around it. Streaming SSR works out of the box.

---

### Styling

| Technology | Version | Role |
|-----------|---------|------|
| Tailwind CSS | 4.2 | Utility-first styling |
| OKLCH color space | — | Perceptually-uniform color tokens |
| tw-animate-css | 1.3 | Animation utilities |
| tailwind-merge | 3.5 | Conflict-free class merging |
| clsx | 2.1 | Conditional class composition |
| class-variance-authority | 0.7 | Component variant management |

**Tailwind 4 over 3:**  
Tailwind 4 ships a Vite plugin (no PostCSS required), native CSS layer support, and significantly faster build times. Design tokens are CSS variables — no Tailwind config object, just `styles.css`.

**Color system:** All colors in OKLCH via CSS custom properties. Dark theme by default — not a toggle, a brand decision. Palette: `--brand` (blue), `--violet` (accent), `--surface-*` (layered backgrounds), `--chart-1` through `--chart-5` (data viz).

---

### UI Components

| Technology | Version | Role |
|-----------|---------|------|
| shadcn/ui | latest | Composable component system |
| Radix UI | 1.x | Accessible headless primitives under shadcn |
| Lucide React | 0.575 | 450+ icon set |
| Framer Motion (motion/react) | 12.38 | Animations |
| Recharts | 3.8 | Data visualization (charts, graphs) |
| Vaul | 1.1 | Drawer primitives |
| Embla Carousel | 8.6 | Carousel |
| react-resizable-panels | 4.6 | Resizable panel layouts |

**shadcn/ui vs. fully custom:**  
shadcn/ui generates component code directly into the project (not a black-box node_module). We own the code, can modify it, and it's always ejectable. Built on Radix = WCAG 2.1 accessibility baked in for free (focus management, keyboard navigation, ARIA).

**Import convention for animations:**  
Always `import { motion } from 'motion/react'` — NOT `from 'framer-motion'`. The package was renamed. Mixing imports will cause bundle duplication.

---

### Forms & Validation

| Technology | Version | Role |
|-----------|---------|------|
| React Hook Form | 7.71 | Performant, uncontrolled form state |
| Zod | 3.24 | Schema validation (client + server shared schemas) |
| @hookform/resolvers | 5.2 | Bridge between RHF and Zod |

**One schema, two uses:**  
Define Zod schemas once in `src/lib/schemas/`. Use them for client-side form validation AND server-side API input validation. No duplication, guaranteed consistency.

---

### Fonts

| Font | Use |
|------|-----|
| Inter | Body text, UI elements |
| JetBrains Mono | Code blocks, timestamps, technical values |

Loaded via CSS `@font-face` with `font-display: swap` — no layout shift on load.

---

## 3. Backend & API Layer

### API Framework

| Technology | Role |
|-----------|------|
| Hono.js | HTTP router running on Cloudflare Workers |
| TypeScript | All handler code typed end-to-end |
| Zod | Request body + query param validation at API boundaries |

**Why Hono over Express/Fastify:**  
Hono is purpose-built for edge runtimes (Cloudflare Workers, Deno Deploy, Bun). Zero Node.js dependencies. 14KB bundle. First-class TypeScript types for request/response. Middleware ecosystem (auth, cors, rate limiting) works on Workers without polyfills.

**Why not tRPC:**  
tRPC couples the client and server too tightly — makes it hard to later expose a public API or integrate with non-React clients. REST with Zod schemas gives the same type safety with more flexibility.

---

### File Upload

| Technology | Role |
|-----------|------|
| Cloudflare R2 | Object storage (audio files) |
| Presigned URLs | Direct client-to-R2 upload (no server proxy) |
| Multipart upload | Chunked upload for files > 100MB |

**Upload flow:**  
Client requests a presigned PUT URL from the API → uploads directly to R2 → sends confirmation to API → API triggers processing job. The app server never touches the audio binary, keeping Workers memory usage near zero.

**Naming convention:**  
`r2://echobrief-audio/{user_id}/{meeting_id}/original.{ext}`

---

### Job Queue

| Technology | Role |
|-----------|------|
| Cloudflare Queues | Async job dispatch and delivery |
| Cloudflare Workers (Consumer) | Job processor (AI pipeline worker) |
| Dead Letter Queue | Failed jobs after 3 retries |

**Processing pipeline jobs:**
```
queue: echobrief-processing
payload: { meeting_id, user_id, audio_url, language }
retry: 3x with exponential backoff
timeout: 15 minutes per job
```

**Why not BullMQ/Redis:**  
Cloudflare Queues is zero-ops and integrates natively with Workers. No Redis instance to manage. For V1/V2 scale, it handles the load with no configuration.

---

### Email

| Technology | Role |
|-----------|------|
| Resend | Transactional email (processing complete, invite, action item digest) |
| React Email | Email template authoring in JSX |

---

## 4. AI & ML Stack

### Speech-to-Text

| Provider | Model | Use Case |
|----------|-------|----------|
| Deepgram | Nova-3 | Primary STT for all uploaded audio |
| OpenAI Whisper | whisper-1 | Fallback if Deepgram fails |

**Why Deepgram over Whisper:**

| | Deepgram Nova-3 | OpenAI Whisper API |
|-|-----------------|-------------------|
| Speed (1hr audio) | ~2–3 min | ~5–8 min |
| Cost | $0.0043/min | $0.006/min |
| Diarization | Native, accurate | Not supported natively |
| Streaming (V3) | Yes (WebSocket) | No |
| Word timestamps | Yes | Yes |
| Accuracy (English) | 97%+ | 96%+ |

Deepgram features used:
- `model=nova-3` — best accuracy
- `diarize=true` — speaker labeling
- `smart_format=true` — punctuation, capitalization, numerals
- `paragraphs=true` — paragraph breaks
- `utterances=true` — speaker-segmented utterances

---

### Language Models

| Provider | Model | Use Case | Why |
|----------|-------|----------|-----|
| Anthropic | Claude 3.5 Sonnet | Summary, action items, Q&A, email gen | Best reasoning; structured JSON via tool_use is deterministic |
| Anthropic | Claude 3.5 Haiku | Meeting score, re-ranking | 10x cheaper than Sonnet; good for classification/scoring tasks |
| OpenAI | text-embedding-3-small | Vector embeddings | Best cost/quality ratio for embeddings; 1536d |

**Why Claude over GPT-4:**
- `tool_use` (Anthropic) produces more consistent structured JSON output than GPT-4's `function_calling` — critical for action item extraction where schema must be exact
- 200k context window handles long meetings without chunking in most cases
- Streaming API is clean and well-documented

**Prompt engineering principles:**
- Always use `tool_use` for structured outputs (never parse freeform JSON from text)
- Include explicit "I don't know" instructions — prevent hallucination in meeting Q&A
- For long meetings: map-reduce pattern (summarize chunks → synthesize)
- Temperature: 0.3 for factual extraction, 0.7 for email/summary generation

**Model selection per task:**

```
Task                         Model              Reason
─────────────────────────────────────────────────────────
Meeting summary              Sonnet 3.5         Complex synthesis
Action item extraction       Sonnet 3.5         Precision required
Per-meeting Q&A              Sonnet 3.5         Best reasoning
Cross-meeting RAG Q&A        Sonnet 3.5         Best reasoning
Meeting score                Haiku 3.5          Simple scoring, cost-sensitive
Email generation             Sonnet 3.5         Quality matters
Re-ranking search results    Haiku 3.5          Fast, cheap classifier
```

**Cost controls:**
- Batch summary + action item extraction in one API call (saves ~50% on Sonnet costs)
- Cache meeting summaries — never re-generate unless transcript changes
- Rate limit: 100 API calls/user/day (free tier), 1000/day (paid)

---

### Vector Search

| Technology | Role |
|-----------|------|
| pgvector (PostgreSQL extension) | Vector storage and similarity search |
| OpenAI text-embedding-3-small | Generating 1536d embeddings |
| IVFFlat index | Approximate nearest-neighbor search at scale |

**Chunking strategy:**
- Chunk size: ~200 words per chunk
- Overlap: 50 words (prevents losing context at boundaries)
- Each chunk stores: `content`, `start_sec`, `end_sec`, `meeting_id`, `user_id`, `embedding`

**Index config:**
```sql
CREATE INDEX ON transcript_chunks 
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
-- lists = sqrt(row_count) is the rule of thumb
-- Re-tune at 1M+ rows
```

**Query flow:**
```
1. Embed query (OpenAI, ~50ms)
2. ANN search: top-20 chunks by cosine similarity
3. Filter by user_id (RLS enforced at DB level)
4. Optional: re-rank with Haiku (~200ms)
5. Pass top-5 chunks to Claude as context
6. Stream answer
```

---

## 5. Data Layer

### Primary Database

| Technology | Version | Role |
|-----------|---------|------|
| PostgreSQL | 15+ | Primary relational database |
| Supabase | — | Managed Postgres hosting + connection pooling |
| pgvector | 0.7+ | Vector similarity search extension |
| PgBouncer | — | Connection pooling (provided by Supabase) |

**Why Supabase:**
- Managed PostgreSQL with zero ops overhead
- pgvector built-in
- Row-Level Security (RLS) enforced at DB level — multi-tenant security without application-layer guards
- Real-time subscriptions (WebSockets) needed for V3 live mode
- Supabase Auth integrates directly — user JWTs verified by PostgreSQL RLS policies

**Row-Level Security policy pattern:**
```sql
-- Users can only see their own meetings
CREATE POLICY "users_own_meetings" ON meetings
  FOR ALL USING (auth.uid() = user_id);

-- Workspace members can see team meetings
CREATE POLICY "workspace_meetings" ON meetings
  FOR SELECT USING (
    visibility = 'team' AND
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid()
    )
  );
```

---

### Object Storage

| Technology | Role |
|-----------|------|
| Cloudflare R2 | Audio file storage |

**Why R2 over S3:**
- Zero egress fees (S3 charges ~$0.09/GB egress — significant for audio streaming)
- Native Cloudflare Workers binding — no SDK, no credentials, no HTTP calls
- S3-compatible API — can swap to S3 without code changes if needed
- Same region as Workers = near-zero latency for signed URL generation

**Retention policy (TBD — see Open Questions in PRD):**  
Proposal: keep audio files for 90 days post-upload, then delete (transcripts are permanent). Users can extend retention on paid plans.

---

### Caching

| Technology | Role |
|-----------|------|
| Cloudflare KV | Session tokens, rate limit counters, feature flags |
| TanStack Query | Client-side response caching with stale-while-revalidate |

**KV usage:**
- Rate limiting counters (key: `ratelimit:{user_id}:{window}`, TTL: 60s)
- Processing job status cache (key: `job:{meeting_id}`, TTL: 5 minutes)
- Feature flags (key: `feature:{name}`, read-heavy, write-rarely)

---

## 6. Infrastructure & Deployment

### Hosting

| Service | What runs on it |
|---------|----------------|
| Cloudflare Workers | SSR frontend + API handlers + AI pipeline workers |
| Cloudflare R2 | Audio file storage |
| Cloudflare Queues | Async job dispatch |
| Cloudflare KV | Edge cache + rate limiting |
| Supabase | PostgreSQL + Auth + Realtime |
| Resend | Transactional email |

**Why fully on Cloudflare:**
- Workers have zero cold starts — critical for API endpoints users hit after uploading
- Global edge network — Workers run in ~300 PoPs, near every user
- Integrated services (R2, Queues, KV) eliminate cross-vendor networking latency
- Pricing: Workers free tier = 100k req/day; R2 = no egress; Queues = $0.40/million messages

---

### Build & Bundler

| Technology | Version | Role |
|-----------|---------|------|
| Vite | 7.3 | Frontend bundler |
| @lovable.dev/vite-tanstack-config | — | Pre-configured Vite preset for TanStack Start |
| @cloudflare/vite-plugin | 1.25 | Cloudflare Workers build target |
| Bun | 1.x | Package manager + script runner |

**Why Bun over npm/pnpm:**
- 3–30x faster installs than npm
- `bunx` replaces `npx` without downloading packages every run
- TypeScript runs natively without `ts-node`
- Drop-in npm replacement — same `package.json`

**Critical:** Always use `bun` for all commands. Do not use npm, npx, yarn, or pnpm in this project.

```bash
bun install       # install deps
bun run dev       # dev server (HMR)
bun run build     # production build
bun run lint      # eslint
bunx shadcn@latest add <component>   # add shadcn component
```

---

### CI/CD (planned)

```
Push to main
    ↓
GitHub Actions
    ↓
bun run build (must pass)
bun run lint (must pass)
TypeScript check (must pass)
    ↓
wrangler deploy --env production
```

Branch previews: Cloudflare Pages (for PR previews — separate from Workers production).

---

### Environments

| Environment | Branch | URL |
|------------|--------|-----|
| Development | local | localhost:3000 |
| Preview | pull requests | auto-generated via Cloudflare |
| Production | main | echobrief.ai (TBD) |

**Environment variables:**  
Managed via Cloudflare Secrets (production) and `.dev.vars` (local). Never committed to git.

```bash
# .dev.vars (local only, gitignored)
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=
DEEPGRAM_API_KEY=
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
RESEND_API_KEY=
R2_BUCKET_NAME=
```

---

## 7. Auth & Security

### Authentication

| Technology | Role |
|-----------|------|
| Supabase Auth | Identity provider + session management |
| Google OAuth 2.0 | Social sign-in |
| JWT | Session tokens |
| httpOnly cookies | Token storage (no localStorage) |

**Session flow:**
```
User clicks "Sign in with Google"
    ↓
Redirect to Supabase Auth (Google OAuth)
    ↓
Google returns to Supabase callback URL
    ↓
Supabase issues JWT + refresh token
    ↓
Tokens stored in httpOnly cookies (not localStorage)
    ↓
Every API request: Cloudflare Worker validates JWT with Supabase JWKS
    ↓
User ID extracted from JWT → passed to PostgreSQL RLS via Supabase client
```

**Why httpOnly cookies over localStorage:**  
localStorage is accessible to any JavaScript on the page — XSS attack reads tokens directly. httpOnly cookies are inaccessible to JavaScript — XSS cannot steal the session.

---

### API Security

| Concern | Mitigation |
|---------|-----------|
| Unauthorized access | JWT required on all `/api/*` routes; Supabase RLS enforces row-level isolation |
| Rate limiting | Per-user rate limits via Cloudflare KV (100 req/min general, 10 req/min AI endpoints) |
| CORS | Strict origin allowlist in Hono CORS middleware |
| Input validation | Zod schemas on all API request bodies and query params |
| SQL injection | Parameterized queries via Supabase client (never raw string interpolation) |
| Secrets | All API keys in Cloudflare Secrets, never in code or `.env` committed to git |
| Audio access | R2 files only accessible via short-lived presigned URLs (1-hour TTL) |

### Data Privacy

- Integration OAuth tokens: AES-256 encrypted before storage
- Audio files: private R2 bucket, no public access
- User deletion: cascade deletes all meetings, transcripts, chunks, embeddings, audio
- GDPR: data deletion endpoint at `DELETE /api/v1/account` removes everything

---

## 8. Integrations

### V2 Integrations (planned)

| Integration | API | Use Case |
|------------|-----|----------|
| Notion | Notion API v1 | Export action items as database entries |
| Linear | Linear API (GraphQL) | Export action items as issues |
| Jira | Jira REST API v3 | Export action items as tickets |
| Google Calendar | Google Calendar API v3 | Export deadlines as events |
| Trello | Trello REST API | Export action items as cards |

**OAuth pattern (same for all):**
```
User clicks "Connect Notion"
    ↓
Redirect to provider's OAuth authorization URL
    ↓
Provider redirects to /api/v1/integrations/notion/callback
    ↓
Exchange code for access + refresh tokens
    ↓
Encrypt tokens, store in integrations table
    ↓
User sees "Notion connected" in settings
```

**Export schema contract:**
```typescript
interface ExportableActionItem {
  title: string          // → task name in all providers
  description: string    // → task body/notes
  assignee?: string      // → assignee (best-effort match by name)
  due_date?: string      // → ISO date string
  source_meeting: string // → link to EchoBrief meeting
  source_timestamp: number // → seconds offset in meeting
}
```

---

## 9. Observability

### Logging

| Technology | Role |
|-----------|------|
| Cloudflare Workers Logs | Request logs, error traces |
| Sentry (planned) | Error tracking + performance monitoring |
| Custom structured logs | AI pipeline step logging (cost, latency, model used) |

**AI pipeline log structure:**
```json
{
  "meeting_id": "uuid",
  "step": "transcription",
  "provider": "deepgram",
  "model": "nova-3",
  "duration_sec": 142,
  "cost_usd": 0.14,
  "status": "success",
  "timestamp": "2026-05-14T10:30:00Z"
}
```

Every AI call is logged with cost and latency. This feeds a cost dashboard for the team (and the analytics feature for users in V2).

### Error Handling

| Layer | Strategy |
|-------|---------|
| Frontend | Error boundaries per route; user-facing messages via Sonner toasts |
| API | Zod validation errors → 400 with field-level messages; unhandled → 500 with Sentry trace |
| AI Pipeline | Retry with exponential backoff (3x); fallback provider; DLQ for permanent failures |
| Upload | Chunked upload with per-chunk retry; resume support |

---

## 10. Developer Tooling

### Code Quality

| Tool | Config | Role |
|------|--------|------|
| TypeScript | `strict: true` | Type checking |
| ESLint | `eslint.config.js` | Linting (flat config format) |
| Prettier | `.prettierrc` | Code formatting |

**TypeScript strict mode enforces:**
- No implicit `any`
- Strict null checks
- No unchecked index access
- Strict function types

**Absolute prohibition:** `any` type. Zero tolerance. Use `unknown` and narrow, use generics, use type inference — never `any`.

### shadcn/ui Component Management

```bash
# Add a new component
bunx shadcn@latest add <component-name>

# Components land in src/components/ui/
# Never modify these files directly — wrap them instead
```

### Path Aliases

Configured in `tsconfig.json` and `vite.config.ts`:

```typescript
// tsconfig.json
{
  "paths": { "@/*": ["./src/*"] }
}

// Usage
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { AppShell } from '@/components/app/app-shell'
```

### Git Conventions

**Branch naming:**
```
feat/meeting-qa          # new feature
fix/upload-chunk-retry   # bug fix
perf/vector-index-tune   # performance
```

**Commit format (strict):**
```
<type>: <description under 50 chars>

<why this change was needed — optional>

Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>
```

Types: `feat`, `fix`, `perf`, `refactor` (only when explicitly requested), `docs`

---

## 11. Decision Log

Decisions made and the reasoning. Captured so future contributors don't re-litigate these.

---

### D-01: TanStack Start over Next.js

**Decision:** Use TanStack Start as the meta-framework.  
**Date:** 2026-03 (Lovable scaffold choice)  
**Reasoning:** Cloudflare Workers is the deployment target. Next.js has no official Cloudflare Workers adapter — requires either Vercel or community adapters with known limitations. TanStack Start is built from the ground up for edge runtimes. Same file-based routing DX, better edge compatibility.  
**Tradeoff:** Smaller ecosystem than Next.js. Less documentation. Risk: if TanStack Start stalls, migration to Next.js is non-trivial.

---

### D-02: pgvector over Pinecone/Weaviate

**Decision:** Store embeddings in PostgreSQL with pgvector, not a dedicated vector DB.  
**Date:** 2026-05  
**Reasoning:** Collocated data = simpler queries (JOIN vectors with meetings in one query), no sync lag, one fewer managed service. pgvector with IVFFlat handles EchoBrief's scale (millions of chunks per user) without issue. Dedicated vector DBs add operational complexity that's only justified at 100M+ vectors.  
**Tradeoff:** pgvector has lower throughput ceiling than Pinecone for very high query rates. If we need >1000 vector queries/second, revisit.

---

### D-03: Claude API over OpenAI GPT-4 for LLM

**Decision:** Use Anthropic Claude as the primary LLM.  
**Date:** 2026-05  
**Reasoning:** Claude's `tool_use` produces more consistent structured JSON output than GPT-4's function calling — tested on meeting transcripts with complex action item schemas. 200k context window handles full meeting transcripts without map-reduce for most use cases. For meetings Q&A, fewer hallucinations in retrieval-augmented contexts (anecdotal, from testing).  
**Tradeoff:** If Anthropic has downtime, no Claude. Mitigation: OpenAI GPT-4o as fallback (same schema, different SDK).

---

### D-04: Deepgram over OpenAI Whisper

**Decision:** Deepgram Nova-3 as primary STT provider.  
**Date:** 2026-05  
**Reasoning:** 2–3x faster than Whisper API for 1-hour audio. ~30% cheaper per minute. Native diarization (required for V2 speaker features). Streaming API available for V3 real-time mode. Whisper doesn't support diarization natively.  
**Tradeoff:** Deepgram is a third-party dependency — single point of failure for transcription. Mitigation: Whisper as fallback.

---

### D-05: Dark Theme as Default (Non-Negotiable)

**Decision:** Dark theme is the EchoBrief visual identity. No light mode toggle.  
**Date:** 2026-03 (design decision)  
**Reasoning:** Professional AI tools (Linear, Vercel, Raycast) trend dark. Aligns with the brand's premium, focused aesthetic. Adding a light mode doubles the design QA surface.  
**Tradeoff:** Not for every user. Revisit in V3 if user research shows strong demand.

---

### D-06: Bun over npm/pnpm

**Decision:** Bun as the package manager and script runner.  
**Date:** 2026-03 (Lovable scaffold choice)  
**Reasoning:** `bun install` is 10–30x faster than npm install in CI. TypeScript runs natively (`bun run file.ts`). Drop-in npm replacement — no migration cost. `bunfig.toml` configures scoped registry for Cloudflare packages.  
**Tradeoff:** Minor ecosystem edge cases (some npm lifecycle scripts behave differently). None encountered in this project yet.

---

## 12. Dependency Map

How the technologies connect at runtime:

```
Browser Request
    │
    ▼
Cloudflare Edge Network
    │
    ▼
Cloudflare Worker (SSR + API)
    ├── TanStack Start → renders React → HTML response
    ├── Hono.js routes → API handlers
    │       ├── Supabase client → PostgreSQL (queries, RLS)
    │       ├── R2 binding → audio storage
    │       ├── KV binding → cache, rate limits
    │       └── Queues binding → dispatch processing jobs
    └── JWT validation → Supabase JWKS endpoint

Cloudflare Queue Consumer (Worker)
    ├── R2 binding → read audio file
    ├── Deepgram API → speech-to-text
    ├── Anthropic API → summary, action items, score
    ├── OpenAI API → embeddings
    └── Supabase client → write results to PostgreSQL

Browser (TanStack Query)
    ├── API calls → Cloudflare Worker API routes
    ├── Streaming responses → ReadableStream (AI chat)
    └── R2 presigned URLs → direct audio upload
```

---

### Package Inventory

**Production dependencies:**

```json
{
  "react": "19.2.0",
  "@tanstack/start": "1.167.50",
  "@tanstack/react-router": "1.168.25",
  "@tanstack/react-query": "5.83.0",
  "hono": "latest",
  "framer-motion": "12.38.0",
  "tailwind-merge": "3.5.0",
  "clsx": "2.1.1",
  "class-variance-authority": "0.7.1",
  "react-hook-form": "7.71.2",
  "zod": "3.24.2",
  "@hookform/resolvers": "5.2.2",
  "recharts": "3.8.1",
  "lucide-react": "0.575.0",
  "date-fns": "4.1.0",
  "openai": "latest",
  "@supabase/supabase-js": "latest"
}
```

**Dev dependencies:**

```json
{
  "typescript": "5.8.3",
  "vite": "7.3.1",
  "@cloudflare/vite-plugin": "1.25.5",
  "eslint": "9.32.0",
  "prettier": "3.7.3",
  "wrangler": "latest"
}
```

---

*This document should be updated whenever a technology is added, replaced, or a significant architectural decision is made. Stale tech stack docs are worse than no tech stack docs.*
