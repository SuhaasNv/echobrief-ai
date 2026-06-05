# EchoBrief AI — Project Context for Claude Code

> Living doc. When the codebase or stack changes meaningfully, update this file in the same session — stale context here costs more than no context.

---

## What This Project Is

EchoBrief is an AI meeting intelligence platform: upload audio (meeting recording, voice memo, Zoom export) → get transcription + AI summary + action items + speaker analysis + ChatGPT-style Q&A across every meeting you've ever uploaded. "Organizational memory AI," not a transcription tool.

**Positioning:** B2B / professional productivity. Target users: startup PMs, engineers, remote teams.

**Portfolio goal:** Demonstrate full-stack AI product thinking — async pipelines, LLM orchestration, vector search, scalable architecture — not just "AI wrapper."

---

## Current State (as of 2026-05-14)

Three live components, all running locally and verified end-to-end:

| Component     | Runtime               | Port | Status                                 |
| ------------- | --------------------- | ---- | -------------------------------------- |
| Frontend SSR  | Vite / TanStack Start | 8080 | Live, mock data                        |
| API (Hono)    | Node.js (tsx)         | 4000 | Live, queries Railway Postgres + Redis |
| BullMQ worker | Node.js (tsx)         | —    | Live, consumes `processing` queue      |
| Postgres      | Railway (managed)     | —    | Live, 11 tables + pgvector + RPC       |
| Redis         | Railway (managed)     | —    | Live, rate-limit + queue               |

**Frontend pages still use `src/lib/mock-data.ts`** — that's the next phase's job. The backend works against the real Railway DB; the frontend doesn't call it yet.

---

## Architecture

```
Browser
  │
  ├─→ http://localhost:8080  (TanStack Start SSR)
  │      └─ Renders React, no API calls yet (mock data)
  │
  └─→ http://localhost:4000  (Hono API on Node)
         ├─ JWT auth (jose, BETTER_AUTH_SECRET) — Better Auth provider not yet wired
         ├─ postgres.js → Railway Postgres (pgvector for semantic search)
         ├─ ioredis → Railway Redis (rate-limit cache)
         └─ BullMQ producer → enqueues processing jobs

Processing Worker (separate Node process)
  ├─ Consumes BullMQ "processing" queue
  ├─ AssemblyAI → transcription + diarization
  ├─ OpenAI GPT-5 → summary + action items (Strict-Mode JSON Schema)
  ├─ OpenAI text-embedding-3-small → chunk embeddings (1536d)
  ├─ OpenAI GPT-5-mini → meeting score
  └─ Resend → user notifications
```

Audio storage: **Cloudflare R2** via S3-compatible API (`@aws-sdk/client-s3` + presigned URLs). Bucket + creds not yet provisioned — env keys present but blank.

---

## Tech Stack — what's actually installed

### Frontend

- **React 19** + **TypeScript 5.8** (strict mode)
- **TanStack Start** — meta-framework, SSR
- **TanStack Router** — file-based routes in `src/routes/`
- **TanStack React Query** — server state (hooks in `src/lib/api/hooks.ts`)
- **Tailwind CSS 4** — OKLCH tokens, dark + light themes
- **shadcn/ui** (new-york style) + **Radix UI** — 45+ components in `src/components/ui/`
- **framer-motion 12** — animations (imports: `from "framer-motion"`, NOT `motion/react`)
- **Recharts** — charts
- **React Hook Form** + **Zod** — forms
- **Lucide React** — icons
- **cmdk** — command palette
- **sonner** — toast notifications

### API + Worker (Node)

- **Hono 4** — HTTP framework
- **@hono/node-server** — Node adapter
- **@hono/zod-validator** — request validation
- **postgres** (postgres.js) — Postgres client, tagged-template SQL
- **ioredis** — Redis client (for rate-limit)
- **bullmq** — job queue (uses its own Redis connection)
- **jose** — JWT verify (HS256, shared `BETTER_AUTH_SECRET`)
- **openai** — GPT-5 + GPT-5-mini + text-embedding-3-small
- **assemblyai** — transcription + diarization
- **@aws-sdk/client-s3** + **@aws-sdk/s3-request-presigner** — R2 access
- **resend** — transactional email
- **dotenv** + **tsx** — env loading + TS runtime

### Tooling

- **Vite 7** (frontend bundler)
- **concurrently** — runs all three dev servers (`npm run dev:all`)
- **wrangler** — frontend SSR deploys to Cloudflare Workers (separate target from the API)

---

## Package manager

**Use `npm`** on this machine. `bun` is not installed locally even though the repo has a `bun.lock`. The `package.json` scripts are written for npm. If bun is reintroduced later, replace `npm run` with `bun run` everywhere; `npx` becomes `bunx`.

---

## Directory Structure

```
src/
├── api.ts                            # Hono server entrypoint (Node)
├── server.ts                         # TanStack Start SSR entrypoint (CF Workers)
├── start.ts                          # Frontend client entry
├── styles.css                        # Tailwind + OKLCH tokens, light + dark
│
├── components/
│   ├── app/                          # App shell (sidebar, header)
│   ├── auth/                         # Auth shell + Google button
│   ├── marketing/                    # Landing components (header, footer, stats-strip, dashboard-preview)
│   ├── theme/
│   │   ├── theme-provider.tsx        # React context + system-pref listener
│   │   └── theme-toggle.tsx          # Animated sun/moon dropdown
│   ├── command-palette.tsx           # Cmd+K palette + provider + useCommandPalette hook
│   ├── logo.tsx
│   └── ui/                           # shadcn — DO NOT MODIFY these files
│
├── hooks/use-mobile.tsx
│
├── lib/
│   ├── api/
│   │   ├── client.ts                 # apiRequest + apiStream + setAuthToken
│   │   └── hooks.ts                  # All TanStack Query hooks per endpoint
│   ├── schemas.ts                    # Shared Zod schemas (client + server contracts)
│   ├── theme.ts                      # Theme storage + no-flash boot script
│   ├── mock-data.ts                  # TEMPORARY — frontend reads from here
│   ├── utils.ts
│   ├── error-capture.ts
│   └── error-page.ts
│
├── routes/                           # TanStack Router file-based routes
│   ├── __root.tsx                    # Mounts ThemeProvider + CommandPaletteProvider + Toaster
│   ├── routeTree.gen.ts              # AUTO-GENERATED — never edit
│   ├── index.tsx                     # Landing
│   ├── login.tsx
│   ├── signup.tsx
│   ├── forgot-password.tsx
│   ├── about.tsx                     # /about — story + timeline
│   ├── privacy.tsx                   # /privacy — TL;DR + sub-processor table
│   ├── terms.tsx                     # /terms — 7 clauses, plain + legal
│   └── app/                          # Authenticated app
│       ├── route.tsx                 # App shell wrapper
│       ├── index.tsx                 # Dashboard
│       ├── meetings/index.tsx        # Meetings list
│       ├── meetings/$id.tsx          # Meeting detail
│       ├── upload.tsx
│       ├── chat.tsx                  # Cross-meeting AI Q&A
│       ├── action-items.tsx
│       ├── shared.tsx
│       ├── analytics.tsx
│       └── settings.tsx
│
└── server/                           # Backend code (Node only)
    ├── env.ts                        # Zod-validated env, ProcessingJob type
    ├── api/
    │   ├── index.ts                  # Hono root: middleware + routes mount
    │   ├── types.ts                  # AppBindings, AuthenticatedUser
    │   ├── middleware/
    │   │   ├── auth.ts               # JWT verify (jose)
    │   │   ├── rate-limit.ts         # Redis sliding window
    │   │   ├── error.ts              # ZodError + HTTPException + 500 envelope
    │   │   └── request-id.ts
    │   └── routes/
    │       ├── meetings.ts           # CRUD + upload-url + status + retry + share
    │       ├── action-items.ts       # list + patch + export
    │       ├── chat.ts               # per-meeting streaming Q&A
    │       ├── search.ts             # cross-meeting RAG (streaming + x-citations header)
    │       ├── integrations.ts       # OAuth (skeleton)
    │       ├── account.ts            # me + export + delete
    │       ├── generate.ts           # email gen (streaming)
    │       └── share.ts              # public /share/:token
    ├── db/
    │   ├── index.ts                  # getSql() — postgres.js singleton
    │   └── types.ts                  # Row types matching migrations
    ├── services/
    │   ├── assemblyai.ts             # Batch + (V3) streaming transcription
    │   ├── llm.ts                    # GPT-5 analyze + score + Q&A + email
    │   ├── openai.ts                 # Embeddings only (LLM lives in llm.ts)
    │   ├── r2.ts                     # S3-compatible presigned URLs
    │   ├── redis.ts                  # ioredis singleton
    │   ├── queue.ts                  # BullMQ producer
    │   └── resend.ts                 # Transactional email
    ├── workers/
    │   ├── main.ts                   # BullMQ Worker entrypoint
    │   └── processing.ts             # Pipeline steps: transcribe → analyze → embed → score
    └── lib/
        ├── prompts.ts                # All LLM prompts + JSON schemas
        ├── chunking.ts               # Transcript → embedding chunks
        └── encryption.ts             # AES-256-GCM for OAuth tokens

migrations/                           # Run with `npm run migrate`
├── 0001_initial_schema.sql           # 11 tables + pgvector
├── 0002_rls_policies.sql             # No-op on Railway (was Supabase RLS)
└── 0003_vector_search_fn.sql         # match_transcript_chunks RPC

scripts/
├── migrate.mjs                       # Migration runner (postgres.js)
└── check-schema.mjs                  # Verify tables/extensions/functions
```

---

## Routes — current state

| Route               | Type      | Status          | Notes                                                          |
| ------------------- | --------- | --------------- | -------------------------------------------------------------- |
| `/`                 | Marketing | ✅ Live         | Animated count-up stats, marquee, hero                         |
| `/login`            | Auth      | ✅ Styled       | Loading state, validation, toasts. Not yet calling Better Auth |
| `/signup`           | Auth      | ✅ Styled       | Password strength meter, validation                            |
| `/forgot-password`  | Auth      | ✅ UI           | Not wired                                                      |
| `/about`            | Marketing | ✅ Real content | Timeline, pillars, stats                                       |
| `/privacy`          | Marketing | ✅ Real content | TL;DR card, sub-processor table                                |
| `/terms`            | Marketing | ✅ Real content | 7 clauses, plain + collapsible legal                           |
| `/app/`             | App       | Mock data       | Dashboard                                                      |
| `/app/meetings`     | App       | Mock data       | List + filters                                                 |
| `/app/meetings/$id` | App       | Mock data       | Detail with tabs                                               |
| `/app/upload`       | App       | Mock data       | Drag-drop UI                                                   |
| `/app/chat`         | App       | Mock data       | Cross-meeting Q&A UI                                           |
| `/app/action-items` | App       | Mock data       | Task list                                                      |
| `/app/shared`       | App       | Mock data       | Shared notes                                                   |
| `/app/analytics`    | App       | Mock data       | Charts                                                         |
| `/app/settings`     | App       | Mock data       | Tabs                                                           |

API endpoints (all under `/api/v1`, all `/api/v1/health` excluded require Bearer JWT):

`GET /health` · `GET|POST|PATCH|DELETE /meetings/*` · `GET|PATCH /action-items/*` · `POST /action-items/:id/export` · `POST /meetings/:id/chat` (stream) · `POST /search` (stream + x-citations) · `POST /generate/email` (stream) · `GET|POST|DELETE /integrations/*` · `GET|PATCH|DELETE /account/me` · `POST /account/export` · `GET /share/:token` (public)

---

## Theme System (light + dark + system)

- Tokens: `:root` is dark by default. `.light` class swaps every token. Defined in `src/styles.css`.
- Boot: `<head>` inline script in `__root.tsx` reads localStorage `echobrief-theme` and sets `<html class="dark|light">` before React hydrates — no flash.
- Provider: `<ThemeProvider>` in `__root.tsx` exposes `useTheme()` (`theme`, `resolved`, `setTheme`).
- Toggle: `<ThemeToggle>` in `app-shell.tsx` header — dropdown with Light / Dark / System + checkmark.
- Reduced motion: global CSS `@media (prefers-reduced-motion: reduce)` kills animations; `useReducedMotion()` from framer-motion handles JS-side conditionals.

**Rule: every visual change must look correct in both themes.** Use design tokens, never hardcoded colors.

---

## Command Palette (Cmd+K)

- `<CommandPaletteProvider>` mounts a global keydown listener in `__root.tsx`.
- Any component can call `useCommandPalette()` to open/close it.
- Sections: Quick actions, Navigate (all 8 app routes), Recent meetings, Theme.
- Built on shadcn `command` (which wraps `cmdk`).

---

## Development Commands

```bash
# Install (uses package-lock.json; bun.lock is stale)
npm install

# Start the full stack — frontend + API + worker — in one terminal
npm run dev:all

# Individual services (separate terminals)
npm run dev          # frontend on :8080
npm run dev:api      # API on :4000
npm run dev:worker   # BullMQ worker (no port)

# Database migrations (against DATABASE_URL in .env)
npm run migrate

# Typecheck (run BOTH before any commit)
npx tsc --noEmit                          # frontend
npx tsc -p tsconfig.api.json --noEmit     # API + worker

# Production builds
npm run build       # frontend → dist/
npm run lint
```

---

## Environment Variables

`.env` is gitignored. `.dev.vars.example` is the template. Required:

| Variable                                                                    | Used by             | Notes                                                   |
| --------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------- |
| `DATABASE_URL`                                                              | API + worker        | Railway Postgres proxy URL in dev, internal URL in prod |
| `REDIS_URL`                                                                 | API + worker        | Same pattern                                            |
| `BETTER_AUTH_SECRET`                                                        | API auth middleware | 32+ chars. Generate: `openssl rand -base64 32`          |
| `ASSEMBLYAI_API_KEY`                                                        | Worker              | Empty → service returns stubs                           |
| `OPENAI_API_KEY`                                                            | Worker + API        | Empty → service returns stubs                           |
| `OPENAI_MODEL_PRIMARY`                                                      | Worker + API        | Default `gpt-5`                                         |
| `OPENAI_MODEL_LIGHT`                                                        | Worker + API        | Default `gpt-5-mini`                                    |
| `RESEND_API_KEY`                                                            | Worker              | Empty → emails logged to console                        |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` | API + worker        | Audio storage                                           |
| `INTEGRATION_TOKEN_ENCRYPTION_KEY`                                          | API                 | 32-byte base64 for AES-256-GCM                          |
| `APP_URL`                                                                   | API + worker        | Frontend origin (`http://localhost:8080` in dev)        |
| `PORT`                                                                      | API                 | `4000` locally; Railway provides its own                |

---

## Code Conventions

### Routing (TanStack Router)

- Routes auto-generate from `src/routes/`. Never edit `routeTree.gen.ts`.
- Use `Link` from `@tanstack/react-router`. Hash-link with `<Link to="/" hash="features">`.
- Use `useParams()`, `useSearch()`, `useNavigate()` from `@tanstack/react-router`.

### Data Fetching

- **API calls go through `src/lib/api/hooks.ts`** — never call `apiRequest` from a component directly.
- Query keys live in `qk` object — use them so invalidations work.
- For streaming endpoints (chat, search, email): use the `streamMeetingChat`, `streamSearch`, `streamEmail` async functions; they return `{ stream: AsyncGenerator<string>, response: Response }`.

### Animations

- Import: `from "framer-motion"`. We're on the framer-motion package, not the `motion/react` rename.
- GPU-only properties: `opacity`, `x`, `y`, `scale`, `rotate`. Never animate `width`, `height`, `top`, `left`.
- Ease curve: `[0.22, 1, 0.36, 1]`. TypeScript-wise, framer-motion 12 needs it typed as `[number, number, number, number]` — use `as const` or explicit tuple cast.
- Reveal duration: 0.6–0.9s. Micro-interactions: 0.15–0.25s.
- Always respect `useReducedMotion()` for non-essential motion.

### Database (postgres.js)

- One singleton per process via `getSql()` from `@/server/db`.
- Tagged-template literals: `` sql`SELECT * FROM meetings WHERE id = ${id}` `` — auto-parameterized.
- Every read includes `WHERE user_id = ${user.id}` (no Supabase RLS on Railway).
- JSONB inserts: `${JSON.stringify(obj)}::jsonb` (avoid `sql.json()` — its types fight us).
- Vectors: `${\`[\${vec.join(",")}]\`}::vector` — pgvector accepts the bracketed string literal.

### shadcn/ui

- Do not modify `src/components/ui/*`. Wrap them instead.
- Add new components: `npx shadcn@latest add <component>`.

### Forms

- React Hook Form + Zod. The Zod schemas live in `src/lib/schemas.ts` and are reused by the API for input validation — keep them as the single source of truth.

### Types

- **No `any`**. Use `unknown` and narrow, or generics.
- Schemas in `src/lib/schemas.ts` export both the Zod object AND a `type` alias via `z.infer<typeof X>`.
- Database row types are in `src/server/db/types.ts` — keep them in sync with migrations.

---

## What's Done (changelog)

### Backend foundation

- Three Railway migrations applied (`0001` schema, `0002` RLS no-op, `0003` `match_transcript_chunks` RPC)
- Hono API with full route coverage (meetings, action-items, chat, search, integrations, account, generate, share)
- JWT auth middleware (jose, HS256)
- Redis-backed sliding-window rate limit (general 100/min, AI 10/min)
- BullMQ processing pipeline with retry + DLQ
- All services typed (AssemblyAI, OpenAI LLM, OpenAI embeddings, R2, Resend)
- E2E verified: signed JWT → GET `/account/me` → 200 with seeded user from Railway

### Frontend polish

- Light + dark + system theme system with no-flash boot
- Command palette (Cmd+K) with cross-route navigation
- Animated count-up stats + marquee logos on landing
- Auth pages: loading states, password strength meter, rotating testimonial card, animated brand orbs
- New marketing pages: `/about`, `/privacy`, `/terms` — designed, not template-generated
- Footer cleaned: only real links, no fake compliance badges
- Toast system (sonner) globally mounted

### Tooling

- `npm run dev:all` starts all three services with color-coded logs
- `tsconfig.api.json` for Node-target typecheck
- `Dockerfile` + `railway.json` for the API/worker
- `.claude/settings.local.json` with structured auto-approvals

---

## Roadmap

`NEXT_PHASE.md` at the repo root has the full plan. Headlines:

**Phase 2 (next):** Better Auth + replace mock data page by page + R2 setup + frontend deploy
**Phase 3:** Cross-meeting search wired in UI, integrations OAuth, email generator UI, meeting score + timeline
**Phase 4:** Live transcription (AssemblyAI Universal-Streaming), team workspaces, real-time collaboration
**Ops (parallel):** Sentry, PostHog, CI, structured logging, healthcheck, audio retention policy

---

## Key Architectural Decisions

1. **Two-vendor split: Railway + Cloudflare.** Railway for stateful (Postgres, Redis) + API + worker (Node). Cloudflare Workers for the frontend SSR (edge-fast page loads). Audio storage on R2 because it's S3-compatible and Railway has no good object storage.

2. **postgres.js over an ORM.** Tagged-template SQL is type-safe enough for our needs, leaner than Prisma/Drizzle, and reads more clearly. App-layer `WHERE user_id` clauses replace Supabase RLS.

3. **OpenAI GPT-5 for LLM, AssemblyAI for STT.** Per project owner — both have clean Node SDKs. Embeddings stay with OpenAI (`text-embedding-3-small`, 1536d) and live in the same Postgres table as transcript chunks via pgvector.

4. **Strict-Mode JSON Schema for structured outputs.** No fragile freeform JSON parsing. The summary + action item extraction is a single GPT-5 call with `response_format: json_schema { strict: true }`.

5. **tsx runtime in production.** Avoids the `.js` extension dance Node ESM requires when running tsc-emitted code. Fast enough for a long-lived API process. The trade-off is a slightly larger Docker image (we bundle dev deps).

6. **JWT-based auth, Better Auth provider to come.** Current middleware accepts any HS256 JWT signed with `BETTER_AUTH_SECRET`. Better Auth integration is the first item in Phase 2.

7. **Light + dark mode are BOTH first-class.** This is no longer "dark only." Every new component must render correctly in both themes.

---

## What "Done" Looks Like for New Features

Before marking a feature complete:

1. `npx tsc --noEmit` and `npx tsc -p tsconfig.api.json --noEmit` both exit 0
2. `npm run build` succeeds (frontend)
3. Tested at 375 / 768 / 1280 viewports
4. **Tested in both light AND dark mode**
5. `prefers-reduced-motion` respected (manual: set OS-level reduced motion and verify nothing animates)
6. No console errors in the dev server
7. If the feature touches the API: smoke-tested with a real signed JWT against Railway
8. If mock data was replaced with real API calls, the loading + empty + error states all work

---

## Gotchas — things that have bitten me

- **postgres.js + sql.json types:** Stricter than expected. Use `${JSON.stringify(obj)}::jsonb` instead of `${sql.json(obj)}`.
- **framer-motion 12 ease tuples:** Type as `[number, number, number, number]` or `as const`. Plain `number[]` will fail strict TS.
- **pgvector inserts:** Vectors go in as a string literal: `${"[1.0,2.0,...]"}::vector`. postgres.js doesn't have first-class vector encoding.
- **Cloudflare Workers types removed from frontend tsconfig.** The frontend uses `types: ["vite/client", "node"]` now. Don't reintroduce `@cloudflare/workers-types` to the root tsconfig — it conflicts with Node DOM types.
- **`bun.lock` is stale.** Don't run `bun install` unless you've reinstalled bun and intend to reconcile.
- **Railway proxy vs internal URLs.** `*.proxy.rlwy.net` works from anywhere (use locally). `*.railway.internal` only inside Railway (use in deployed services). Reference variables `${{ Postgres.DATABASE_URL }}` resolve to internal automatically.
- **`.env` and Railway credentials.** Don't paste credentials into committed files. `.env` is gitignored; `.dev.vars` too.
