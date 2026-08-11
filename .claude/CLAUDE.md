# EchoBrief AI — Project Context for Claude Code

> Living doc. When the codebase or stack changes meaningfully, update this file in the same session — stale context here costs more than no context.

---

## What This Project Is

EchoBrief is an AI meeting intelligence platform: upload audio (meeting recording, voice memo, Zoom export) → get transcription + AI summary + action items + speaker analysis + ChatGPT-style Q&A across every meeting you've ever uploaded. "Organizational memory AI," not a transcription tool.

**Positioning:** B2B / professional productivity. Target users: startup PMs, engineers, remote teams. A "student" account kind adds flashcards + a `/app/study` route.

**Portfolio goal:** Demonstrate full-stack AI product thinking — async pipelines, LLM orchestration, vector search, scalable architecture — not just "AI wrapper."

---

## Current State (as of 2026-07-05)

| Component     | Runtime               | Port | Status                                            |
| ------------- | --------------------- | ---- | ------------------------------------------------- |
| Frontend SSR  | Vite / TanStack Start | 8080 | Live, wired to real API (mock data retired)       |
| API (Hono)    | Node.js (tsx)         | 4000 | Live, queries Railway Postgres + Redis            |
| BullMQ worker | Node.js (tsx)         | —    | Live, consumes `processing` queue                 |
| Postgres      | Railway (managed)     | —    | Live, 8 migrations applied, pgvector + RPC        |
| Redis         | Railway (managed)     | —    | Live, rate-limit + queue                          |

**Production (Railway project `echo-brief`, deployed 2026-07-05):** `api` service live at `https://api-production-5cfb.up.railway.app` (domain targets port 3000; `PORT=3000` is set explicitly because Railway otherwise injects 8080) and `worker` service running both queues. Both build from the repo Dockerfile via `railway up --service <name>`; `railway.json`'s startCommand dispatches on `SERVICE_ROLE` (set to `worker` on the worker service). DB/Redis use reference variables `${{Postgres.DATABASE_URL}}` / `${{Redis.REDIS_URL}}`. The frontend is ALSO on Railway: `echobrief` service at `https://echobrief-production.up.railway.app`, built with `Dockerfile.web` (via `RAILWAY_DOCKERFILE_PATH` service variable) + `vite.config.railway.ts` (cloudflare plugin disabled → Node SSR bundle) and served by `scripts/serve-web.mjs` (@hono/node-server: static assets + SSR fetch handler). `VITE_API_URL` is baked in at image build time — changing it requires a rebuild, not just a restart. `APP_URL` on api/worker points at the frontend URL (CORS allowlist reads it). Note: `railway.json` must NOT contain a `build` section — config-as-code overrides the per-service `RAILWAY_DOCKERFILE_PATH` variable and would force every service onto the root Dockerfile. The Cloudflare Workers target (`wrangler.jsonc` + default `vite.config.ts`) still exists but is unused in production.

Since the last snapshot: self-hosted auth (argon2 + JWT) replaced the Better Auth plan, multi-workspace support with data partitioning, account kinds (professional/student) + flashcards, subscriptions + usage quotas, admin panel + admin worker controls, live audio recording with AssemblyAI streaming transcription, Sentry, a vitest test suite, and three GitHub Actions CI pipelines.

---

## Architecture

```
Browser
  │
  ├─→ http://localhost:8080  (TanStack Start SSR)
  │      └─ React app calling the API via src/lib/api/hooks.ts
  │
  └─→ http://localhost:4000  (Hono API on Node)
         ├─ Self-hosted auth: /auth/signup + /auth/login issue HS256 JWTs (AUTH_SECRET);
         │  argon2 password hashing; middleware re-loads the user row per request
         ├─ postgres.js → Railway Postgres (pgvector for semantic search)
         ├─ ioredis → Railway Redis (rate-limit + usage/quota cache)
         └─ BullMQ producer → enqueues processing jobs

Workers (separate Node process, src/server/workers/main.ts)
  ├─ processing: AssemblyAI transcribe+diarize → GPT-5 summary/action items
  │  (Strict JSON Schema) → text-embedding-3-small chunks (1536d) → GPT-5-mini score
  ├─ cleanup-r2: audio retention cleanup
  └─ export-account: async account data export (archiver)
```

Audio storage: **Cloudflare R2** via S3-compatible API (`@aws-sdk/client-s3` + presigned URLs).

---

## Tech Stack — what's actually installed

### Frontend

- **React 19** + **TypeScript 5.8** (strict mode)
- **TanStack Start** — meta-framework, SSR
- **TanStack Router** — file-based routes in `src/routes/` (flat-file naming: `app.meetings.tsx`, `app.meetings_.$id.tsx`)
- **TanStack React Query** — server state (hooks in `src/lib/api/hooks.ts`)
- **Tailwind CSS 4** — OKLCH tokens, dark + light themes
- **shadcn/ui** (new-york style) + **Radix UI** — 45+ components in `src/components/ui/`
- **framer-motion 12** — animations (imports: `from "framer-motion"`, NOT `motion/react`)
- **Recharts** — charts · **React Hook Form** + **Zod** — forms · **Lucide** — icons · **cmdk** — palette · **sonner** — toasts

### API + Worker (Node)

- **Hono 4** + **@hono/node-server** + **@hono/zod-validator**
- **postgres** (postgres.js) — tagged-template SQL
- **ioredis** — rate-limit + usage cache; **bullmq** — job queue (own Redis connection)
- **jose** — JWT sign/verify (HS256, `AUTH_SECRET`); **argon2** — password hashing
- **openai** — GPT-5 + GPT-5-mini + text-embedding-3-small
- **assemblyai** — batch + streaming transcription
- **@aws-sdk/client-s3** + presigner — R2; **resend** — email; **archiver** — account export zips
- **@sentry/node** + profiling — error tracking (enabled when `SENTRY_DSN` set)
- **dotenv** + **tsx** — env loading + TS runtime

### Tooling

- **Vite 7** (frontend bundler), **vitest 4** (+ coverage, UI), **eslint 9** + **prettier**
- **concurrently** — `npm run dev:all` runs all three dev servers
- **wrangler** — frontend SSR deploys to Cloudflare Workers (separate target from the API)
- **GitHub Actions** — `.github/workflows/`: `ci-backend.yml`, `ci-frontend.yml`, `ci-responsible-ai.yml` (backend CI uses a pgvector Postgres image + Gitleaks)

---

## Package manager

**Use `npm`** on this machine. `bun` is not installed locally even though the repo has a `bun.lock`. If bun is reintroduced later, replace `npm run` with `bun run`; `npx` becomes `bunx`.

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
│   ├── app/                          # App shell (sidebar, header, workspace switcher)
│   ├── auth/                         # Auth shell + password reveal
│   ├── marketing/                    # Landing components
│   ├── theme/                        # ThemeProvider + ThemeToggle
│   ├── command-palette.tsx           # Cmd+K palette + useCommandPalette hook
│   └── ui/                           # shadcn — DO NOT MODIFY these files
│
├── lib/
│   ├── api/
│   │   ├── client.ts                 # apiRequest + apiStream + setAuthToken
│   │   ├── hooks.ts                  # All TanStack Query hooks per endpoint
│   │   └── use-subscription.ts       # Subscription/quota hooks
│   ├── audio/recorder.ts             # Live-recording capture for streaming transcription
│   ├── schemas.ts                    # Shared Zod schemas (client + server contracts)
│   ├── theme.ts                      # Theme storage + no-flash boot script
│   └── utils.ts / error-capture.ts / error-page.ts
│
├── routes/                           # TanStack Router FLAT-FILE routes (dots = nesting)
│   ├── __root.tsx                    # ThemeProvider + CommandPaletteProvider + Toaster
│   ├── routeTree.gen.ts              # AUTO-GENERATED — never edit
│   ├── index.tsx · login.tsx · signup.tsx · forgot-password.tsx
│   ├── about.tsx · privacy.tsx · terms.tsx
│   ├── share.$token.tsx              # Public shared meeting view
│   ├── admin.tsx + admin/            # Admin panel (users, workers)
│   ├── app.tsx                       # App shell layout route
│   └── app.index.tsx · app.meetings.tsx · app.meetings_.$id.tsx ·
│       app.upload.tsx · app.chat.tsx · app.action-items.tsx · app.shared.tsx ·
│       app.analytics.tsx · app.settings.tsx · app.study.tsx (flashcards)
│
└── server/                           # Backend code (Node only)
    ├── env.ts                        # Zod-validated env, ProcessingJob type
    ├── api/
    │   ├── index.ts                  # Hono root: middleware + routes mount
    │   ├── middleware/               # auth (JWT), rate-limit, quota, error, request-id
    │   └── routes/                   # auth, meetings, action-items, chat, search,
    │                                 # flashcards, workspaces, subscription, analytics,
    │                                 # streaming, integrations, account, generate,
    │                                 # share, health, docs, admin, admin-workers
    ├── db/                           # getSql() singleton + row types
    ├── services/                     # assemblyai, llm, openai (embeddings), r2, redis,
    │                                 # queue, resend, usage-tracker, cost-monitor,
    │                                 # responsible-ai, webhooks (+ __tests__/)
    ├── workers/                      # main.ts, processing.ts, cleanup-r2.ts, export-account.ts
    └── lib/                          # prompts, chunking, encryption (AES-256-GCM)

migrations/                           # npm run migrate — each has a *_rollback.sql
├── 0001_initial_schema.sql           # 11 tables + pgvector
├── 0002_rls_policies.sql             # No-op on Railway (was Supabase RLS)
├── 0003_vector_search_fn.sql         # match_transcript_chunks RPC
├── 0004_clerk_user_id.sql            # (legacy Clerk column)
├── 0005_custom_auth.sql              # password_hash, is_admin, sessions
├── 0006_workspaces.sql               # Multi-workspace partitioning
├── 0007_account_kind_and_flashcards.sql
├── 0008_subscriptions_and_usage.sql  # Plans, quotas, usage_logs (columnar)
└── add-performance-indexes.sql       # Bypassed in test env (see recent commits)

scripts/                              # migrate, check-schema, dump, seed-admin,
                                      # test-r2-cleanup, test-subscription-api
tests/
├── integration/                      # vitest: auth, meetings, admin, health,
│                                     # subscription, quota-middleware
├── load/api-stress.js                # Load test script
└── responsible-ai.test.ts
```

---

## API Surface

All under `/api/v1`; everything except `/health`, `/auth/*`, `/docs`, and `/share/:token` requires a Bearer JWT.

`POST /auth/signup|login` · `GET /health` · `GET|POST|PATCH|DELETE /meetings/*` (+ upload-url, status, retry, share) · `GET|PATCH /action-items/*` + export · `POST /meetings/:id/chat` (stream) · `POST /search` (stream + x-citations) · `POST /generate/email` (stream) · streaming transcription token routes · flashcards CRUD · workspaces CRUD + switch · subscription/usage endpoints · analytics · `GET|POST|DELETE /integrations/*` · `GET|PATCH|DELETE /account/me` + export · `GET /share/:token` (public) · admin + admin-workers (require `is_admin`)

Auth model: `/auth/login` verifies argon2 hash, signs an HS256 JWT with `AUTH_SECRET` (`sub` = user id). `requireAuth` middleware verifies the token and **re-loads the user row from Postgres on every request** — admin flips take effect immediately, no token refresh. Login/signup errors are anti-enumeration by design (same message for wrong email vs wrong password) — don't "fix" that.

---

## Theme System (light + dark + system)

- Tokens: `:root` is dark by default. `.light` class swaps every token. Defined in `src/styles.css`.
- Boot: `<head>` inline script in `__root.tsx` reads localStorage `echobrief-theme` and sets `<html class>` before hydration — no flash.
- `useTheme()` from `<ThemeProvider>`; `<ThemeToggle>` in the app shell header.
- Reduced motion: global CSS media query + `useReducedMotion()` from framer-motion.

**Rule: every visual change must look correct in both themes.** Use design tokens, never hardcoded colors.

---

## Development Commands

```bash
npm install               # uses package-lock.json; bun.lock is stale

npm run dev:all           # frontend + API + worker, color-coded logs
npm run dev               # frontend on :8080
npm run dev:api           # API on :4000
npm run dev:worker        # BullMQ worker (no port)

npm run migrate           # migrations against DATABASE_URL in .env
npm run seed:admin        # seed an admin user

# Typecheck (run BOTH before any commit)
npm run typecheck                         # frontend (tsc --noEmit)
npm run build:api                         # API + worker (tsc -p tsconfig.api.json --noEmit)

# Tests (vitest)
npm test                  # single run
npm run test:watch        # watch mode
npm run test:coverage     # with coverage
npx vitest run tests/integration/auth.test.ts        # single file
npx vitest run -t "quota"                            # by test name

npm run build             # frontend production build → dist/
npm run lint              # eslint
npm run format            # prettier --write
```

Integration tests hit a real Postgres (CI uses a pgvector image) and expect migrations applied; rate limits are bypassed in the test env.

---

## Environment Variables

`.env` is gitignored. `.dev.vars.example` is the template. Schema lives in `src/server/env.ts` (Zod — missing optional keys degrade to stubs with a console warning).

| Variable                                                      | Used by      | Notes                                                    |
| ------------------------------------------------------------- | ------------ | -------------------------------------------------------- |
| `DATABASE_URL`                                                | API + worker | Railway Postgres proxy URL in dev, internal URL in prod  |
| `REDIS_URL`                                                   | API + worker | Same pattern                                             |
| `AUTH_SECRET`                                                 | API auth     | 32+ chars, HS256 JWT signing. `openssl rand -base64 32`  |
| `ASSEMBLYAI_API_KEY`                                          | Worker + API | Empty → transcription fails/stubs                        |
| `OPENAI_API_KEY`                                              | Worker + API | Empty → AI features stubbed                              |
| `OPENAI_MODEL_PRIMARY` / `OPENAI_MODEL_LIGHT`                 | Worker + API | Defaults `gpt-5` / `gpt-5-mini`                          |
| `RESEND_API_KEY`                                              | Worker       | Empty → emails logged to console                         |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` / `R2_PUBLIC_BASE_URL` | API + worker | Audio storage |
| `INTEGRATION_TOKEN_ENCRYPTION_KEY`                            | API          | base64 (44+ chars) for AES-256-GCM                       |
| `SENTRY_DSN`                                                  | API + worker | Optional — enables Sentry                                |
| `APP_URL`                                                     | API + worker | Frontend origin                                          |
| `PORT`                                                        | API          | `4000` locally; Railway provides its own                 |

---

## Code Conventions

### Routing (TanStack Router)

- Flat-file routes: dots create nesting (`app.settings.tsx` → `/app/settings`); trailing underscore escapes a layout (`app.meetings_.$id.tsx` renders outside the meetings list layout). Never edit `routeTree.gen.ts`.
- Use `Link`, `useParams()`, `useSearch()`, `useNavigate()` from `@tanstack/react-router`.

### Data Fetching

- **API calls go through `src/lib/api/hooks.ts`** — never call `apiRequest` from a component directly.
- Query keys live in the `qk` object — use them so invalidations work.
- Streaming endpoints (chat, search, email): use `streamMeetingChat` / `streamSearch` / `streamEmail`; they return `{ stream: AsyncGenerator<string>, response: Response }`.

### Animations

- Import `from "framer-motion"` (not `motion/react`).
- GPU-only properties: `opacity`, `x`, `y`, `scale`, `rotate`. Never animate `width`, `height`, `top`, `left`.
- Ease curve `[0.22, 1, 0.36, 1]` — type as a tuple (`as const`) for strict TS.
- Reveal duration 0.6–0.9s; micro-interactions 0.15–0.25s. Respect `useReducedMotion()`.

### Database (postgres.js)

- One singleton per process via `getSql()` from `@/server/db`.
- Tagged-template literals — auto-parameterized.
- Every read scopes by `user_id` (and `workspace_id` where partitioned) — no RLS on Railway.
- JSONB inserts: `${JSON.stringify(obj)}::jsonb` (avoid `sql.json()`).
- Vectors: bracketed string literal + `::vector` cast.
- New migrations need a matching `*_rollback.sql`.

### shadcn/ui

- Do not modify `src/components/ui/*`. Wrap them instead. Add with `npx shadcn@latest add <component>`.

### Forms & Types

- React Hook Form + Zod; schemas in `src/lib/schemas.ts` are the single source of truth for client AND API validation.
- **No `any`**. DB row types live in `src/server/db/types.ts` — keep in sync with migrations.

---

## Roadmap

`NEXT_PHASE.md` at the repo root has the full plan. Done since Phase 2 kicked off: custom auth, mock-data replacement, workspaces, flashcards/study, subscriptions + quotas, admin panel, live streaming transcription, Sentry, CI. Remaining headlines: integrations OAuth, team collaboration, PostHog, frontend production deploy polish.

---

## Key Architectural Decisions

1. **Two-vendor split: Railway + Cloudflare.** Railway for stateful (Postgres, Redis) + API + worker (Node, Dockerfile + `railway.json`). Cloudflare Workers for the frontend SSR. Audio on R2 (S3-compatible).
2. **postgres.js over an ORM.** Tagged-template SQL; app-layer `WHERE user_id` clauses replace RLS.
3. **OpenAI GPT-5 for LLM, AssemblyAI for STT.** Embeddings: `text-embedding-3-small` (1536d) in Postgres via pgvector.
4. **Strict-Mode JSON Schema for structured outputs.** No freeform JSON parsing.
5. **tsx runtime in production.** Avoids the ESM `.js` extension dance; Docker image type-checks at build time.
6. **Self-hosted auth (replaced the Better Auth plan).** argon2 + HS256 JWT + per-request user reload. Anti-enumeration login errors are intentional.
7. **Light + dark mode are BOTH first-class.**
8. **Usage quotas + cost monitoring.** `usage-tracker` + `cost-monitor` services gate AI endpoints via quota middleware; subscriptions define limits (migration 0008).

---

## What "Done" Looks Like for New Features

1. `npm run typecheck` and `npm run build:api` both exit 0
2. `npm test` passes; `npm run build` succeeds
3. Tested at 375 / 768 / 1280 viewports, **in both light AND dark mode**
4. `prefers-reduced-motion` respected
5. No console errors in the dev server
6. If the feature touches the API: smoke-tested with a real signed JWT against Railway
7. Loading + empty + error states all work for new data-driven UI

---

## Gotchas — things that have bitten me

- **postgres.js + sql.json types:** Use `${JSON.stringify(obj)}::jsonb` instead of `${sql.json(obj)}`.
- **framer-motion 12 ease tuples:** Type as `[number, number, number, number]` or `as const`.
- **pgvector inserts:** String literal + `::vector`; postgres.js has no vector encoding.
- **Migrations + tests:** No `CONCURRENTLY` in migrations (they run in transactions); `add-performance-indexes.sql` is bypassed in the test env; test SQL must match the columnar `usage_logs` schema.
- **Anti-enumeration auth:** login/signup deliberately return identical errors for unknown email vs bad password — tests assert this; don't make errors "more helpful."
- **Cloudflare Workers types stay out of the root tsconfig** — conflicts with Node DOM types.
- **`bun.lock` is stale.** Don't run `bun install`.
- **Railway proxy vs internal URLs.** `*.proxy.rlwy.net` from anywhere (local dev); `*.railway.internal` only inside Railway. Reference variables `${{ Postgres.DATABASE_URL }}` resolve to internal automatically.
- **`.env` and Railway credentials.** Never paste credentials into committed files.
