# EchoBrief — Next Phase Plan

**Last updated:** 2026-05-14
**Current state:** Backend live on Railway (Postgres + Redis), frontend uses mock data, theme system + command palette + API client just landed.

---

## Phase 2 — Wire UI to real backend (the most important phase)

**Goal:** End-to-end working app from sign-up → upload audio → see transcript + summary + Q&A. No more mock data on any user-facing screen.

### 2.1 Better Auth integration
- [ ] Install `better-auth` + `better-auth-react`
- [ ] Generate Better Auth's schema migration; run on Railway Postgres
- [ ] Mount Better Auth handler at `/api/auth/*` in `src/api.ts`
- [ ] Wire `sign-in`, `sign-up`, `forgot-password` pages to the SDK
- [ ] Update `requireAuth` middleware to consume Better Auth sessions (the `jose` JWT check stays as a fallback for service tokens)
- [ ] Add Google OAuth provider via Better Auth (creds already in env)
- [ ] Protect `/app/*` routes with a `beforeLoad` guard that redirects to `/login` when unauthenticated

### 2.2 Replace mock data, page by page
Each page below currently imports from `src/lib/mock-data.ts`. Convert one at a time so the rest keeps working.

- [ ] `/app/` (Dashboard) → `useMeetings({ limit: 5 })`, `useActionItems({ completed: false })`, stat counts
- [ ] `/app/meetings` → `useMeetings(query)` with filter chips
- [ ] `/app/meetings/$id` → `useMeeting(id)` + `useMeetingStatus(id)` polling
- [ ] `/app/upload` → `useUploadUrl()` → PUT to R2 → `useConfirmUpload()`
- [ ] `/app/chat` → `streamSearch()` with citation rendering
- [ ] `/app/action-items` → `useActionItems()` + `usePatchActionItem()`
- [ ] `/app/analytics` → new endpoint `GET /api/v1/analytics/summary` (server aggregate)
- [ ] `/app/settings` → `useMe()`, `useUpdateProfile()`, `useIntegrations()`

### 2.3 R2 setup
- [ ] Create R2 bucket `echobrief-audio` in Cloudflare
- [ ] Generate R2 API token (S3-compatible credentials)
- [ ] CORS config on the bucket to allow PUT from frontend origin
- [ ] Set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` in Railway

### 2.4 Frontend → API URL config
- [ ] Add `VITE_API_URL=https://api.echobrief.app/api/v1` env var
- [ ] CORS in Hono needs the frontend origin in production
- [ ] Vercel/Cloudflare deploy for frontend separate from Railway backend

### 2.5 Better empty states + skeletons
- [ ] Skeleton components per route (Dashboard, Meetings list, Meeting detail)
- [ ] Empty states: illustration + headline + 1-sentence guidance + CTA, on:
  - First-time dashboard (no meetings yet)
  - Meetings list with active filters (no results)
  - Action items "all done" celebration
  - AI Chat (no meetings to ask about)

---

## Phase 3 — V2 differentiator features

### 3.1 Cross-meeting semantic Q&A (the killer demo)
- [ ] Wire `/app/chat` to `streamSearch()` with live citations
- [ ] Click citation → navigate to meeting + scroll to timestamp
- [ ] Suggested-query chips on empty state (5 thoughtful prompts)
- [ ] Conversation history in component state (no DB persistence in V2)

### 3.2 Integrations (OAuth flows)
- [ ] Notion OAuth (set up app, get client_id/secret)
- [ ] Linear OAuth
- [ ] Google Calendar OAuth
- [ ] Wire the real token exchange in `/api/v1/integrations/:provider/callback`
- [ ] Replace stub `pending_<provider>_token` with actual API calls
- [ ] Per-provider export adapters (action item → Notion DB entry / Linear issue / Calendar event)

### 3.3 Email generator UI
- [ ] Modal/slide-out in meeting detail page
- [ ] Type selector (Recap, Stakeholder, Sprint, Assignment)
- [ ] Tone selector (Professional / Casual)
- [ ] `streamEmail()` into an editable textarea
- [ ] Copy to clipboard + "Open in Gmail" mailto link

### 3.4 Smart timeline view + meeting score
- [ ] Chapter chips with hover preview on meeting detail
- [ ] Score badge in meeting list rows
- [ ] Score detail drawer with 5-component breakdown
- [ ] Trend chart on Analytics page (last 30 days)

---

## Phase 4 — V3 ambitious

### 4.1 Live transcription (voice agent)
- [ ] AssemblyAI Universal-Streaming WebSocket integration
- [ ] New route `/app/live` with start/stop button
- [ ] WebSocket relay endpoint in the API (browser ↔ API ↔ AssemblyAI)
- [ ] Live action item detection (Claude Haiku-equivalent on rolling 30s windows)
- [ ] Save session as a regular meeting on stop

### 4.2 Team workspaces
- [ ] Workspace switcher in sidebar
- [ ] Invite by email flow (Resend transactional email)
- [ ] Role-based access (admin / member / viewer)
- [ ] Visibility toggle on meetings (private vs team)

### 4.3 Collaboration
- [ ] Text selection → "Add comment" popover on transcript
- [ ] @mention with email notification
- [ ] Highlight categories (decision / risk / question / note)
- [ ] Comments sidebar with realtime sync (Postgres LISTEN/NOTIFY or polling)

---

## Operational tasks (parallel to features)

- [ ] **CI**: GitHub Actions running `typecheck`, `lint`, `build`, `build:api` on PRs
- [ ] **Migrations**: add a CI job that runs migrations against a temporary Postgres
- [ ] **Sentry** for both frontend and API (error tracking)
- [ ] **PostHog** for product analytics + feature flags
- [ ] **Logging**: structured pino logs in the API (currently console.log)
- [ ] **Healthcheck**: deeper `/api/v1/health` — pings DB and Redis
- [ ] **Backups**: confirm Railway Postgres backup retention
- [ ] **Audio retention policy**: 90-day default with optional extension on paid plans
- [ ] **Cost dashboard**: aggregate `pipeline_logs.cost_usd` into a UI panel for ops

---

## Quick wins (under 30 min each)

- [ ] Animated count-up on dashboard stat cards
- [ ] Confetti when first meeting completes
- [ ] OG image generator (Vercel OG or Cloudflare image transformations)
- [ ] Keyboard shortcuts dialog (?, Cmd+/)
- [ ] Sidebar collapse state persisted to localStorage
- [ ] Meeting card hover preview (summary on hover)
- [ ] Sound feedback on AI chat response complete (subtle, opt-in)

---

## Definition of "shipped"

A phase is shipped only when:
1. `npm run build` and `npx tsc -p tsconfig.api.json --noEmit` both exit 0
2. Tested at 375 / 768 / 1280 viewports
3. Light + dark mode both render correctly
4. `prefers-reduced-motion` is respected
5. No console errors in the dev server
6. The corresponding user flow works end-to-end with real backend data
