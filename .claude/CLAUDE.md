# EchoBrief AI — Project Context for Claude Code

## What This Project Is

EchoBrief is an AI meeting intelligence platform. The vision: upload any audio (meeting recording, voice memo, Zoom export, YouTube URL) and get a transcription, AI summary, action items, speaker analysis, and a ChatGPT-style interface to query the meeting's content. Think "organizational memory AI" — not just a transcription tool.

**Positioning:** B2B / professional productivity angle. Target users: startup PMs, engineers, remote teams.

**Portfolio goal:** Demonstrate full-stack AI product thinking — async pipelines, LLM orchestration, vector search, scalable architecture — not just "AI wrapper."

---

## Current State

**Frontend only.** Built with Lovable (AI-generated scaffold). All data is mocked via `src/lib/mock-data.ts`. No real backend, no auth, no API calls yet.

The frontend is production-ready in terms of UI quality. The next phase is wiring it to real backend services.

---

## Tech Stack

### Frontend
- **React 19** + **TypeScript 5.8** (strict mode)
- **TanStack Start 1.x** — meta-framework (SSR, file-based routing via TanStack Router)
- **TanStack Router** — file-based routes under `src/routes/`
- **TanStack React Query** — server state management (queryClient in router context)
- **Tailwind CSS 4** — styling, dark-by-default, OKLCH color tokens
- **shadcn/ui** (new-york style) + **Radix UI** — 45+ components in `src/components/ui/`
- **Framer Motion 12** — animations
- **Recharts** — data visualization
- **React Hook Form** + **Zod** — forms and validation
- **Lucide React** — icons

### Build & Deploy
- **Vite 7** (bundler via `@lovable.dev/vite-tanstack-config`)
- **Bun** (package manager — use `bun` not `npm`/`yarn`)
- **Cloudflare Workers** — deployment target (edge runtime, SSR via `src/server.ts`)
- `wrangler.jsonc` — Cloudflare config

### Planned Backend (not yet built)
- **FastAPI** or **NestJS** for AI pipeline orchestration
- **PostgreSQL** + **pgvector** for storage + semantic search
- **Redis** for job queues and caching
- **Supabase** for auth
- **Deepgram** or **OpenAI Whisper** for speech-to-text
- **Claude API** (Anthropic) for summarization, Q&A, action item extraction
- **Pinecone** or **pgvector** for vector embeddings (meeting Q&A feature)

---

## Directory Structure

```
src/
├── components/
│   ├── app/          # App shell + sidebar layout (app-shell.tsx, auth-shell.tsx)
│   ├── auth/         # Auth form UI shells (login, signup, forgot-password)
│   ├── marketing/    # Landing page components (site-header, site-footer, dashboard-preview)
│   └── ui/           # shadcn/ui components — DO NOT modify these files
├── hooks/
│   └── use-mobile.tsx
├── lib/
│   ├── mock-data.ts  # All mocked backend data — temporary, will be replaced with API calls
│   ├── utils.ts      # cn() utility (clsx + tailwind-merge)
│   ├── error-capture.ts
│   └── error-page.ts
├── routes/           # File-based routes (TanStack Router auto-generates routeTree.gen.ts)
│   ├── __root.tsx
│   ├── index.tsx             # Landing page
│   ├── login.tsx
│   ├── signup.tsx
│   ├── forgot-password.tsx
│   └── app/
│       ├── route.tsx         # App shell wrapper
│       ├── index.tsx         # Dashboard
│       ├── meetings/
│       │   ├── index.tsx     # Meetings list
│       │   └── $id.tsx       # Meeting detail (transcript, summary, action items)
│       ├── upload.tsx        # File upload + progress
│       ├── chat.tsx          # Cross-meeting AI Q&A (streaming)
│       ├── action-items.tsx
│       ├── shared.tsx        # Shared notes
│       ├── analytics.tsx
│       └── settings.tsx
├── routeTree.gen.ts  # AUTO-GENERATED — never edit this manually
├── router.tsx
├── server.ts         # SSR entry for Cloudflare Workers
├── start.ts          # App entry point
└── styles.css        # Tailwind base + design tokens
```

---

## Routes Overview

| Route | Purpose | Status |
|-------|---------|--------|
| `/` | Marketing landing page | Done (mock) |
| `/login` | Sign in | UI done, no auth |
| `/signup` | Create account | UI done, no auth |
| `/app/` | Dashboard with stats + chart | Mock data |
| `/app/meetings` | Meetings list | Mock data |
| `/app/meetings/$id` | Meeting detail (transcript, summary, Q&A) | Mock data |
| `/app/upload` | Audio upload with progress | UI done, no backend |
| `/app/chat` | AI chat across all meetings | UI done, no backend |
| `/app/action-items` | Task management | Mock data |
| `/app/shared` | Shared notes | Mock data |
| `/app/analytics` | Meeting analytics + charts | Mock data |
| `/app/settings` | Profile, workspace, billing, integrations | UI done |

---

## Design Tokens & Styling

**Color system:** OKLCH-based CSS variables in `src/styles.css`. Dark theme by default.

Key tokens:
- `--brand` — primary brand blue
- `--violet` — accent violet
- `--success`, `--warning` — status colors
- `--surface-*` — layered surface backgrounds
- `--chart-1` through `--chart-5` — data viz palette
- `--sidebar-*` — sidebar-specific tokens

Custom utilities: `shadow-elegant`, `shadow-glow`, `gradient-brand`, `gradient-glow`

Fonts: Inter (body), JetBrains Mono (code/mono)

**Do not change color values without design approval.** The palette is intentional.

---

## Development Commands

```bash
bun install          # Install dependencies
bun run dev          # Start dev server
bun run build        # Production build — MUST pass before any commit
bun run lint         # ESLint
```

**Always use `bun`, not `npm` or `yarn`.**

---

## Code Conventions for This Project

### Routing (TanStack Router)
- New routes = new files in `src/routes/`. The route tree auto-generates.
- Never edit `routeTree.gen.ts` — it's auto-generated by the dev server.
- Use `Link` from `@tanstack/react-router` (not `<a>` tags or Next.js `Link`).
- Use `useParams`, `useSearch` from TanStack Router for route params.

### Data Fetching
- Use TanStack Query (`useQuery`, `useMutation`) for any server state.
- `queryClient` is available via router context.
- Mock data lives in `src/lib/mock-data.ts` — when wiring real APIs, replace the mock source but keep the same data shape.

### Animations
- Import from `motion/react` (NOT `framer-motion`).
- Keep GPU-compositable properties: `opacity`, `x`, `y`, `scale`, `rotate`.
- Respect `useReducedMotion()` for accessibility.

### shadcn/ui Components
- Do not modify files in `src/components/ui/` directly.
- If customization is needed, wrap the component in a new component in `src/components/app/` or `src/components/marketing/`.
- Add new shadcn components with: `bunx shadcn@latest add <component>`

### Forms
- All forms use React Hook Form + Zod schema validation.
- No uncontrolled inputs outside of RHF's `register`.

---

## Feature Roadmap

### Version 1 (current focus — wire the frontend to real AI)
- [ ] Supabase auth (Google login + email/password)
- [ ] Audio upload to Cloudflare R2 / S3
- [ ] Deepgram transcription pipeline
- [ ] Claude API: summarization + action item extraction
- [ ] Real meeting detail page (replace mock data)
- [ ] Dashboard stats from real DB

### Version 2
- [ ] Meeting Q&A via pgvector + Claude (the "ask anything" killer feature)
- [ ] Cross-meeting semantic search
- [ ] Speaker diarization
- [ ] Notion/Linear/Jira action item export

### Version 3
- [ ] Team workspaces + collaboration
- [ ] AI meeting score (participation, sentiment, actionability)
- [ ] Multi-language support
- [ ] Real-time transcription (WebSockets)

---

## Key Architectural Decisions

1. **TanStack Start over Next.js** — chosen by the Lovable scaffold; edge-first, Cloudflare Workers deployment. Routing and data fetching patterns differ from Next.js.
2. **Mock data first** — entire UI was built against `src/lib/mock-data.ts`. When adding real APIs, preserve the same TypeScript interfaces so components don't need changes.
3. **Dark theme default** — this is intentional brand design, not a user preference. Don't add a light mode toggle unless explicitly requested.
4. **Cloudflare Workers** — the SSR runtime is Cloudflare's edge, not Node.js. Avoid Node-only APIs (`fs`, `path`, etc.) in server code.
5. **Bun** — package manager and runtime for scripts. Do not use npm/npx; use bun/bunx.

---

## What "Done" Looks Like for New Features

Before marking any feature complete:
1. `bun run build` passes with zero errors and zero TypeScript errors
2. The feature works with mock data replaced by real data (when applicable)
3. Tested at 375px (mobile), 768px (tablet), 1280px (desktop)
4. No console errors or warnings
5. Animations work smoothly
