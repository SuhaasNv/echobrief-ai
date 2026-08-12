# EchoBrief iOS 1.0 — Schema & Data Contract Specification

> Status: authoritative reference for the native client. Everything here was read
> out of the repo at `main` (commit `dd4f7d6`). Every claim carries a `file:line`
> citation. Where the Zod schema, the migration, and the route handler disagree,
> all three are shown and the one that actually governs the wire is named.
>
> **Rule for this document:** nothing is invented. If a field is not in a
> `SELECT` list, it is not in the response, no matter what `src/lib/schemas.ts`
> declares. Section 9 is the only section that proposes changes.

---

## 0. Scope of iOS 1.0

Derived from the existing app routes (`src/routes/app.*.tsx`) minus the surfaces
that make no sense on a phone.

| # | Screen | Backing endpoints | In 1.0 |
|---|--------|-------------------|--------|
| 1 | Sign in / Sign up | `POST /auth/login`, `POST /auth/signup`, `GET /auth/google` | Yes |
| 2 | Meetings list | `GET /meetings` | Yes |
| 3 | Meeting detail (transcript, summary, score) | `GET /meetings/:id`, `GET /meetings/:id/audio-url`, `GET /meetings/:id/status` | Yes |
| 4 | Speaker rename sheet | `PATCH /meetings/:id/speakers` | Yes |
| 5 | Record (in-app capture) | `POST /streaming/token`, `POST /meetings/upload-url`, `PUT <presigned>`, `POST /meetings/from-live` | Yes |
| 6 | Import audio file | `POST /meetings/upload-url`, `PUT <presigned>`, `POST /meetings` | Yes |
| 7 | Action items | `GET /action-items`, `PATCH /action-items/:id`, `DELETE /action-items/:id` | Yes |
| 8 | Per-meeting chat | `POST /meetings/:id/chat` (stream) | Yes |
| 9 | Cross-meeting search | `POST /search` (stream + `x-citations`) | Yes |
| 10 | Workspace switcher | `GET /workspaces` | Yes |
| 11 | Settings / account | `GET /account/me`, `PATCH /account/me`, `GET /subscription` | Yes |
| 12 | Share sheet | `POST /meetings/:id/share` | Yes |
| — | Analytics, Study/flashcards, Admin, Integrations, Email generation | — | **No** — deferred to 1.1+ |

Everything below is written against that scope. Endpoints outside it are
mentioned only where they share a table or a landmine.

---

## 1. Database schema reference

Postgres 15+ on Railway. Extensions: `pgcrypto`, `vector`
(`migrations/0001_initial_schema.sql:8-9`).

### 1.1 Authorization model — there is no RLS

`migrations/0002_rls_policies.sql:13-16` is deliberately a **no-op**
(`SELECT 1;`). The header states it outright:

> On Railway Postgres we enforce authorization at the application layer: every
> query in `src/server/db/*` includes a `WHERE user_id = $user_id` clause,
> sourced from the JWT-authenticated request.
> — `migrations/0002_rls_policies.sql:5-7`

A single pooled superuser connection serves every request
(`src/server/db/index.ts:33-43`, `max: 100`, `prepare: false`). **Every scoping
mistake is a cross-tenant data leak.** Section 1.6 documents the exact `WHERE`
clause each read depends on.

### 1.2 ER diagram

```
                             ┌──────────────────────────┐
                             │        users             │
                             │ id (PK, uuid)            │
                             │ email UNIQUE             │
                             │ password_hash NULL       │
                             │ google_id NULL (uq idx)  │
                             │ is_admin                 │
                             │ default_account_type     │
                             └───┬──────────────────┬───┘
                                 │ owner_id         │ user_id
                                 │ (CASCADE)        │ (CASCADE)
                     ┌───────────▼────────────┐     │
                     │      workspaces        │     │
                     │ id (PK)                │     │
                     │ name, color, kind      │     │
                     │ owner_id → users       │     │
                     └───┬──────────────┬─────┘     │
                         │              │           │
      ┌──────────────────▼───┐          │           │
      │  workspace_members   │          │           │
      │ PK(workspace_id,     │          │           │
      │    user_id)          │          │           │
      │ role admin|member|   │          │           │
      │      viewer          │          │           │
      └──────────────────────┘          │           │
                                        │           │
                        ┌───────────────▼───────────▼──────────────┐
                        │              meetings                    │
                        │ id (PK)                                  │
                        │ user_id      → users     NOT NULL ◄─ P   │
                        │ workspace_id → workspaces NOT NULL ◄─ P  │
                        │ title, audio_key, audio_size(BIGINT),    │
                        │ audio_mime, duration_sec, language,      │
                        │ status(CHK), failure_reason, visibility, │
                        │ share_token UNIQUE, tags TEXT[],         │
                        │ meeting_score JSONB, retry_count,        │
                        │ created_at, processed_at, recorded_at    │
                        └──┬────────┬─────────┬─────────┬──────────┘
                           │1:1     │1:1      │1:N      │1:N
              ┌────────────▼──┐  ┌──▼────────┐│  ┌──────▼─────────────┐
              │  transcripts  │  │ summaries ││  │ transcript_chunks  │
              │ meeting_id UQ │  │meeting_id ││  │ meeting_id         │
              │ raw_text TEXT │  │   UNIQUE  ││  │ user_id     ◄─ P   │
              │ content JSONB │  │ executive ││  │ workspace_id ◄─ P  │
              │ speakers JSONB│  │ key_topics││  │ chunk_index        │
              │ speaker_names │  │ decisions ││  │ content TEXT       │
              │        JSONB  │  │ open_qs   ││  │ start_sec,end_sec  │
              │ language      │  │ chapters  ││  │ embedding VECTOR   │
              │ provider      │  │   JSONB   ││  │            (1536)  │
              └───────────────┘  │ model     ││  └────────────────────┘
                                 └───────────┘│
                                              │
                          ┌───────────────────▼──────────────┐
                          │          action_items            │
                          │ id (PK)                          │
                          │ meeting_id → meetings            │
                          │ user_id      → users     ◄─ P    │
                          │ workspace_id → workspaces ◄─ P   │
                          │ description, assignee_name,      │
                          │ assignee_id → users NULL,        │
                          │ due_date DATE, completed,        │
                          │ completed_at, timestamp_sec,     │
                          │ export_refs JSONB                │
                          └──────────────────────────────────┘

  ┌────────────────────┐  ┌──────────────────┐  ┌────────────────────────┐
  │   subscriptions    │  │   usage_logs     │  │      flashcards        │
  │ user_id UNIQUE ◄─P │  │ user_id     ◄─ P │  │ meeting_id             │
  │ tier(CHK)          │  │ workspace_id NULL│  │ workspace_id  ◄─ P     │
  │ status(CHK)        │  │ period 'YYYY-MM' │  │ user_id       ◄─ P     │
  │ stripe_* UNIQUE    │  │ transcription_   │  │ question, answer       │
  │ billing_interval   │  │   minutes        │  │ difficulty(CHK)        │
  │ current_period_*   │  │ ai_queries_count │  │ last_reviewed_at       │
  │ price_usd NUMERIC  │  │ flashcards_gen'd │  │ review_count           │
  │ edu_email_verified │  │ total_cost_usd   │  └────────────────────────┘
  └────────────────────┘  │ UQ(user,ws,per)  │
                          └──────────────────┘

  ┌────────────────────┐  ┌──────────────────────┐  ┌────────────────────┐
  │   integrations     │  │   pipeline_logs      │  │  meeting_comments  │
  │ UQ(user_id,provider│  │ meeting_id NULL      │  │ meeting_id         │
  │ access_token (enc) │  │ user_id NULL         │  │ user_id            │
  │ metadata JSONB     │  │ step, provider,model │  │ range_*_sec        │
  └────────────────────┘  │ cost_usd NUMERIC     │  │ highlight(CHK)     │
                          │ status(CHK)          │  │ parent_id (self)   │
                          │ metadata JSONB       │  └────────────────────┘
                          └──────────────────────┘

  ◄─ P  =  partition key. Application code MUST include it in the WHERE clause.
```

### 1.3 Table-by-table column reference (mobile-relevant tables)

#### `users` — `0001:16-23`, `0005:11-18`, `0007:26-28`, `0009:20-28`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `email` | TEXT | NO | — | UNIQUE |
| `name` | TEXT | YES | — | |
| `avatar_url` | TEXT | YES | — | https URL **or** a `data:image/...;base64` URL up to 100 KB (`src/lib/schemas.ts:395-403`) |
| `password_hash` | TEXT | YES | — | argon2id. NULL for Google-only users (`0005:14-15`) |
| `google_id` | TEXT | YES | — | Partial UNIQUE index `users_google_id_key WHERE google_id IS NOT NULL` (`0009:26-28`) |
| `is_admin` | BOOLEAN | NO | `FALSE` | `0005:17-18` |
| `default_account_type` | TEXT | YES | — | CHECK `('student','professional')` (`0007:26-28`) |
| `created_at` / `updated_at` | TIMESTAMPTZ | YES | `now()` | `updated_at` maintained by trigger `users_set_updated_at` (`0001:226-228`) |

`clerk_user_id` was added in `0004:14-15` and **dropped** in `0005:11-12`. It does
not exist. `src/server/db/types.ts:19-31` is accurate for this table.

#### `workspaces` — `0001:28-34`, `0006:24-26`, `0007:18-20`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `name` | TEXT | NO | — | max 60 chars enforced in Zod only (`src/server/api/routes/workspaces.ts:23`) |
| `logo_url` | TEXT | YES | — | **Never selected by any route.** Dead column for the client. |
| `owner_id` | UUID | NO | — | → `users(id)` ON DELETE CASCADE |
| `color` | TEXT | NO | `'brand'` | CHECK `('brand','violet','emerald','amber','rose','slate')` (`0006:25-26`) |
| `kind` | TEXT | NO | `'professional'` | CHECK `('student','professional')` (`0007:19-20`) |
| `created_at` | TIMESTAMPTZ | YES | `now()` | |

Indexes: `workspaces_owner_idx(owner_id, created_at)` (`0006:98-99`),
`workspaces_owner_kind_idx(owner_id, kind)` (`0007:22-23`).

> **There is no `WorkspaceRow` in `src/server/db/types.ts`.** The shape is
> declared inline at `src/server/api/routes/workspaces.ts:34-41` and duplicated
> in the web client at `src/lib/api/hooks.ts:49-56`. The iOS model must be
> derived from the route, not from `db/types.ts`.

#### `workspace_members` — `0001:36-45`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `workspace_id` | UUID | (PK part) | — | → `workspaces(id)` CASCADE |
| `user_id` | UUID | (PK part) | — | → `users(id)` CASCADE |
| `role` | TEXT | NO | — | CHECK `('admin','member','viewer')` |
| `joined_at` | TIMESTAMPTZ | YES | `now()` | |

PK `(workspace_id, user_id)`; index `workspace_members_user_idx(user_id)`.

**No endpoint exposes `role`.** `GET /workspaces` (`workspaces.ts:48-53`) selects
only workspace columns. Membership role is invisible to any client. Do not model
it in 1.0.

#### `meetings` — `0001:50-80` + `0011:18-23` ◄ partitioned by `user_id` AND `workspace_id`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `user_id` | UUID | **NO** | — | → `users(id)` CASCADE. **Partition key.** |
| `workspace_id` | UUID | **NO** | — | → `workspaces(id)` CASCADE (`0006:72-80` promoted it to NOT NULL and re-pointed the FK from `SET NULL` to `CASCADE`). **Partition key.** `src/server/db/types.ts:49` still types it `string \| null` — **stale; it cannot be null.** |
| `title` | TEXT | NO | — | |
| `audio_key` | TEXT | YES | — | R2 object key `{user_id}/{meeting_id}/original.{ext}` (`src/server/services/r2.ts:44-47`). NULL for pasted-transcript meetings. |
| `audio_size` | BIGINT | YES | — | **BIGINT → postgres.js returns a STRING.** See §3.6. |
| `audio_mime` | TEXT | YES | — | Free text at the DB level; constrained only by `SupportedMime` on the write path. |
| `duration_sec` | INTEGER | YES | — | Set by the client on upload, overwritten by the worker after transcription (`src/server/workers/processing.ts:97`). |
| `language` | TEXT | YES | `'en'` | `src/server/db/types.ts:55` types it non-null — true in practice via the default, but a raw `INSERT` omitting it yields `'en'`, never NULL. |
| `status` | TEXT | NO | `'queued'` | CHECK `('queued','transcribing','analyzing','indexing','complete','failed')` (`0001:60-61`) |
| `failure_reason` | TEXT | YES | — | |
| `visibility` | TEXT | NO | `'private'` | CHECK `('private','team')` |
| `share_token` | TEXT | YES | — | UNIQUE. 32 hex chars (`randomBytes(16)`, `meetings.ts:786`) |
| `tags` | TEXT[] | YES | `ARRAY[]::TEXT[]` | Postgres array, **not** JSONB |
| `meeting_score` | JSONB | YES | — | **Double-encoding hazard — §3.2** |
| `retry_count` | INTEGER | YES | `0` | |
| `created_at` | TIMESTAMPTZ | YES | `now()` | Upload time |
| `processed_at` | TIMESTAMPTZ | YES | — | |
| `recorded_at` | TIMESTAMPTZ | YES | — | **`0011:18-19`.** NULL = unknown; callers must fall back to `created_at`. |

Indexes:
- `meetings_user_created_idx(user_id, created_at DESC)` — `0001:73-74`
- `meetings_workspace_idx(workspace_id) WHERE workspace_id IS NOT NULL` — `0001:75-76` (predicate now always true)
- `meetings_status_idx(status) WHERE status != 'complete'` — `0001:77-78`
- `meetings_tags_idx USING gin(tags)` — `0001:79-80`
- `meetings_workspace_created_idx(workspace_id, created_at DESC)` — `0006:89-90` ← **this is the one the list query uses**
- `meetings_user_recorded_at_idx(user_id, recorded_at DESC NULLS LAST)` — `0011:22-23` ← **currently unused**; nothing sorts or filters on `recorded_at` (see §3.1)

#### `transcripts` — `0001:85-97` + `0010:21-22` (1:1 with meetings, no `user_id`)

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `meeting_id` | UUID | NO | — | **UNIQUE** → `meetings(id)` CASCADE |
| `raw_text` | TEXT | NO | — | |
| `content` | **JSONB** | NO | — | `{ words[], paragraphs[] }`. **Double-encoding hazard — §3.2** |
| `speakers` | **JSONB** | YES | `'[]'::JSONB` | `[{id,label,talk_time_sec,word_count}]`. **Double-encoding hazard — §3.2** |
| `speaker_names` | **JSONB** | **NO** | `'{}'::jsonb` | `0010:21-22`. `{"A":"Maya"}`. Keys are raw AssemblyAI labels. |
| `language` | TEXT | YES | — | |
| `provider` | TEXT | YES | `'deepgram'` | Actual values written: `'assemblyai'` (`processing.ts:87`), `'user'` (`meetings.ts:143`), `'assemblyai-streaming'` (`meetings.ts:199`). The `'deepgram'` default is vestigial. |
| `created_at` | TIMESTAMPTZ | YES | `now()` | |

Index `transcripts_text_idx USING gin(to_tsvector('english', raw_text))`
(`0001:96-97`) — **built and never used.** No route does full-text search on
transcripts; `GET /meetings?q=` searches `title ILIKE` only (`meetings.ts:265`).

**Critical:** `transcripts` has **no `user_id` and no `workspace_id`**. Every
access must be authorized by first proving ownership of the parent meeting. The
speaker-rename endpoint does exactly that and says why
(`meetings.ts:606-612`).

#### `summaries` — `0001:102-112` (1:1 with meetings, no `user_id`)

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `meeting_id` | UUID | NO | — | UNIQUE → `meetings(id)` CASCADE |
| `executive` | TEXT | YES | — | |
| `key_topics` / `decisions` / `open_questions` | TEXT[] | YES | `ARRAY[]::TEXT[]` | Postgres arrays — **not** JSONB, no double-encoding risk |
| `chapters` | **JSONB** | YES | `'[]'::JSONB` | `[{title,start_sec,end_sec,summary}]`. **Double-encoding hazard — §3.2** |
| `model` | TEXT | YES | — | |
| `generated_at` | TIMESTAMPTZ | YES | `now()` | Never exposed to any client. |

#### `action_items` — `0001:117-136` + `0006:53-55,82-83` ◄ partitioned by `user_id` AND `workspace_id`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | UUID | NO | `gen_random_uuid()` | PK |
| `meeting_id` | UUID | NO | — | → `meetings(id)` CASCADE |
| `user_id` | UUID | **NO** | — | → `users(id)` CASCADE. **Partition key.** |
| `workspace_id` | UUID | **NO** | — | Added + backfilled + NOT NULL'd in `0006:53-60,82-83`. **Partition key.** `src/server/db/types.ts:90-104` **omits this column entirely** — stale. |
| `description` | TEXT | NO | — | |
| `assignee_name` | TEXT | YES | — | |
| `assignee_id` | UUID | YES | — | → `users(id)` ON DELETE **SET NULL**. Never written by any code path. |
| `due_date` | **DATE** | YES | — | **DATE, not TIMESTAMPTZ.** postgres.js parses it to a JS `Date` → serializes as a full ISO datetime. See §3.7. |
| `completed` | BOOLEAN | YES | `false` | |
| `completed_at` | TIMESTAMPTZ | YES | — | Never selected by any client-facing route. |
| `timestamp_sec` | INTEGER | YES | — | Offset into the recording |
| `export_refs` | **JSONB** | YES | `'{}'::JSONB` | `{notion:"...",linear:"..."}`. **Double-encoding hazard — §3.2** |
| `created_at` / `updated_at` | TIMESTAMPTZ | YES | `now()` | trigger `action_items_set_updated_at` (`0001:230-232`) |

Indexes: `action_items_user_idx(user_id, completed, due_date)` (`0001:133-134`),
`action_items_meeting_idx(meeting_id)` (`0001:135-136`),
`action_items_workspace_idx(workspace_id, completed, due_date)` (`0006:92-93`).

#### `transcript_chunks` — `0001:141-159` + `0006:62-64,85-86` ◄ partitioned by `user_id` AND `workspace_id`

`embedding VECTOR(1536)`, ivfflat index with `lists = 100` (`0001:157-159`).
Relevant to the client only because `POST /search` reads it and because the
default `ivfflat.probes = 1` used to destroy recall — the route now sets
`SET LOCAL ivfflat.probes = 10` inside a transaction (`search.ts:53-55`) and
uses a `0.25` similarity floor (`search.ts:69`), **not** the `0.5` the RPC in
`0003_vector_search_fn.sql:13` defaults to. The RPC `match_transcript_chunks` is
**dead code** — no route calls it; `search.ts` inlines its own query, and unlike
the RPC it also filters `workspace_id` (`search.ts:68`), which the RPC does not
(`0003:39`).

#### `subscriptions` — `0008:18-48` ◄ partitioned by `user_id` (UNIQUE)

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `user_id` | UUID | NO | — | **UNIQUE** — one row per user |
| `tier` | TEXT | NO | `'free'` | CHECK `('free','student','pro','team')` |
| `status` | TEXT | NO | `'active'` | CHECK `('active','cancelled','past_due','trialing')` |
| `stripe_customer_id` / `stripe_subscription_id` | TEXT | YES | — | UNIQUE. Never populated. |
| `billing_interval` | TEXT | YES | — | CHECK `('monthly','annual')` |
| `current_period_start` / `current_period_end` | TIMESTAMPTZ | YES | — | |
| `price_usd` | **NUMERIC(10,2)** | YES | — | **NUMERIC → postgres.js returns a STRING.** §3.6 |
| `edu_email_verified` | BOOLEAN | YES | `false` | |

Every existing user was backfilled to `('free','active')` (`0008:111-114`), but
`GET /subscription` also defends against a missing row with an in-code default
(`subscription.ts:88-98`).

#### `usage_logs` — `0008:64-85`

Columnar monthly rollup, `UNIQUE (user_id, workspace_id, period)`, `period` is
`'YYYY-MM'` computed in **UTC** (`src/server/services/usage-tracker.ts:57-62`).
`workspace_id` is nullable here and `ON DELETE SET NULL`. `total_cost_usd` is
NUMERIC → string.

### 1.4 Enum-bearing CHECK constraints (single source of truth)

| Table.column | Allowed values | Migration |
|---|---|---|
| `meetings.status` | `queued`, `transcribing`, `analyzing`, `indexing`, `complete`, `failed` | `0001:60-61` |
| `meetings.visibility` | `private`, `team` | `0001:63-64` |
| `workspaces.color` | `brand`, `violet`, `emerald`, `amber`, `rose`, `slate` | `0006:25-26` |
| `workspaces.kind` | `student`, `professional` | `0007:19-20` |
| `workspace_members.role` | `admin`, `member`, `viewer` | `0001:39` |
| `users.default_account_type` | `student`, `professional` | `0007:27-28` |
| `subscriptions.tier` | `free`, `student`, `pro`, `team` | `0008:23-24` |
| `subscriptions.status` | `active`, `cancelled`, `past_due`, `trialing` | `0008:27-28` |
| `subscriptions.billing_interval` | `monthly`, `annual` | `0008:35` |
| `flashcards.difficulty` | `easy`, `medium`, `hard` | `0007:38` |
| `integrations.provider` | `notion`, `linear`, `jira`, `google_calendar`, `trello` | `0001:167` |
| `pipeline_logs.status` | `success`, `failure` | `0001:207` |
| `meeting_comments.highlight` | `decision`, `risk`, `question`, `note` | `0001:187` |

### 1.5 Cascade behaviour the client must anticipate

- `DELETE /account/me` → `DELETE FROM users` (`account.ts:170`) cascades to
  workspaces → meetings → transcripts, summaries, action_items,
  transcript_chunks, flashcards. R2 objects are deleted best-effort **before**
  the DB delete and failures are swallowed (`account.ts:163-166`).
- `DELETE /meetings/:id` cascades to transcripts, summaries, action items,
  chunks, flashcards, comments, and pipeline logs. R2 object deleted
  best-effort (`meetings.ts:650-652`).
- `DELETE /workspaces/:id` is refused if the workspace holds any meetings
  (`workspaces.ts:129-136`) or is the user's only workspace
  (`workspaces.ts:119-126`), so no surprise cascade.
- `action_items.assignee_id` is `ON DELETE SET NULL` — irrelevant in practice,
  nothing writes it.

### 1.6 Exact `WHERE` clauses each read depends on

This is the security contract. A native client cannot verify it, but it must
know it to reason about what `X-Workspace-Id` changes.

| Read | Scoping predicate | Source |
|---|---|---|
| `GET /meetings` | `user_id = $u AND workspace_id = $w` (+ optional filters) | `meetings.ts:260` |
| `GET /meetings` count | same `whereClause` reused | `meetings.ts:315-317` |
| `GET /meetings/:id` | `id = $id AND user_id = $u AND workspace_id = $w` | `meetings.ts:349` |
| ↳ transcript sub-read | `meeting_id = $id` **only** — safe because the parent read already gated | `meetings.ts:361` |
| ↳ summary sub-read | `meeting_id = $id` **only** — same reasoning | `meetings.ts:371-372` |
| `GET /meetings/:id/status` | `id AND user_id AND workspace_id` | `meetings.ts:700` |
| `GET /meetings/:id/audio-url` | `id AND user_id AND workspace_id` | `meetings.ts:669` |
| `PATCH /meetings/:id` | `id AND user_id AND workspace_id` | `meetings.ts:592` |
| `PATCH /meetings/:id/speakers` | ownership proven on `meetings` first (`meetings.ts:608-612`), then `UPDATE transcripts WHERE meeting_id = $id` (`meetings.ts:622-627`) | — |
| `DELETE /meetings/:id` | `id AND user_id AND workspace_id` (×2: select then delete) | `meetings.ts:646,653` |
| `POST /meetings` (confirm) | `id AND user_id AND workspace_id` | `meetings.ts:231` |
| `POST /meetings/:id/retry` | `id AND user_id AND workspace_id` | `meetings.ts:741` |
| `POST /meetings/:id/share` | `id AND user_id AND workspace_id` | `meetings.ts:788` |
| `GET /action-items` | `ai.user_id = $u AND ai.workspace_id = $w` | `action-items.ts:32` |
| `PATCH /action-items/:id` | `id AND user_id AND workspace_id` | `action-items.ts:86` |
| `DELETE /action-items/:id` | `id AND user_id AND workspace_id` | `action-items.ts:97` |
| `POST /meetings/:id/chat` | `m.id AND m.user_id AND m.workspace_id` | `chat.ts:29` |
| `POST /search` | `c.user_id = $u AND c.workspace_id = $w` | `search.ts:67-68` |
| `GET /workspaces` | `JOIN workspace_members ON m.user_id = $u` | `workspaces.ts:50-51` |
| `GET /account/me` | `id = $u` | `account.ts:38` |
| `GET /subscription` | `user_id = $u` | `subscription.ts:84` |
| `GET /share/:token` | `m.share_token = $token` — **no user scoping, by design** | `share.ts:37` |

**Two known scoping asymmetries** (documenting, not proposing fixes):

1. `POST /generate/email` scopes by `m.user_id` only — **no `workspace_id`**
   (`generate.ts:45`), unlike every other meeting read. Out of iOS 1.0 scope,
   but note it if 1.1 adds email generation.
2. `GET /integrations` and `DELETE /integrations/:provider` scope by `user_id`
   only (`integrations.ts:28`, `integrations.ts:126`) — correct, since the
   `integrations` table has no `workspace_id`. But the routes still sit behind
   `requireWorkspace` (`src/server/api/index.ts:124`), so a workspace is
   resolved and then ignored.

---

## 2. API contract catalogue

### 2.0 Global request/response envelope

**Base URL.** All routes live under `/api/v1`
(`src/lib/api/client.ts:9`). Production API:
`https://api-production-5cfb.up.railway.app/api/v1`.

**Headers the client sends:**

| Header | When | Notes |
|---|---|---|
| `authorization: Bearer <jwt>` | every route except `/health`, `/ready`, `/auth/*`, `/docs`, `/share/:token` | HS256, 7-day expiry (`auth.ts:40`) |
| `content-type: application/json` | all bodies | |
| `x-workspace-id: <uuid>` | **optional**, on every workspace-scoped route | Omit → server falls back to the user's **oldest** workspace (`workspace.ts:41-53`). Sending an id you're not a member of → **403** |
| `x-request-id` | optional | echoed; in the CORS allowlist (`index.ts:63`) |

**Headers the client must read:**

| Header | Where | Notes |
|---|---|---|
| `x-citations` | `POST /search` responses | `encodeURIComponent(JSON.stringify(SearchCitation[]))` (`search.ts:114`). Present even on the no-results path with value `%5B%5D` (`search.ts:82`). |
| `x-ratelimit-limit` / `-remaining` / `-reset` | every rate-limited route | `rate-limit.ts:134-136`. `-reset` is a **Unix epoch second**, not a delta. |
| `retry-after` | 429 responses | seconds |
| `x-request-id` | all | for support/debugging |

All of the above are in the CORS `exposeHeaders` list (`index.ts:68-75`) — which
matters for the web client only; a native URLSession sees all headers
unconditionally.

**Response body size guard.** Requests with `content-length > 10 MB` are
rejected with **413** before routing (`request-limits.ts:19,34-38`). Any single
header over 8 KB → **431** (`request-limits.ts:20,44-48`). This applies to the
API only; the presigned `PUT` to R2 goes straight to Cloudflare and is capped at
500 MB by `UploadUrlRequest.size` (`src/lib/schemas.ts:91-95`).

#### 2.0.1 There are FOUR distinct error body shapes — this is the single biggest native-client hazard

`src/lib/schemas.ts:416-421` declares one:

```ts
export const ApiError = z.object({
  error: z.string(), message: z.string(), details: z.unknown().optional(),
});
```

The server actually emits four:

| # | Shape | Emitted by | Status |
|---|---|---|---|
| **A** | `{ "error": string, "message": string }` | `errorHandler` for any `HTTPException` without a custom `res` (`error.ts:17-23`); `requireAuth` (`auth.ts:20,25,35,39-46,55`); `requireWorkspace` (`workspace.ts:18,36,49`); `requireAdmin` (`auth.ts:74`) | 4xx |
| **B** | `{ "error": "validation_error", "message": "Request validation failed", "details": <ZodFlattened> }` | `errorHandler` when a **route handler** throws a `ZodError` — i.e. a **response** `.parse()` failure (`error.ts:26-35`) | 400 |
| **C** | `{ "success": false, "error": { "issues": [ { code, path, message, ... } ], "name": "ZodError" } }` | **`zValidator` request-body/query validation failure.** `@hono/zod-validator@0.4.3` returns `c.json(result, 400)` directly and **never reaches `errorHandler`** (`node_modules/@hono/zod-validator/dist/index.js:29-31`) | 400 |
| **D** | `{ "error": "quota_exceeded", "message": string, "tier": string, "current": number, "limit": number }` | quota middleware via `HTTPException.res` (`quota.ts:77-92`, honoured at `error.ts:12-14`) | 429 |
| **D′** | `{ "error": "rate_limited", "message": string, "retry_after_seconds": number, "limit": number, "window_seconds": number }` | `rateLimit()` (`rate-limit.ts:145-155`) | 429 |
| **D″** | `{ "error": "rate_limited", "message": string }` — **no** `retry_after_seconds` | `checkAuthRateLimit()` on login/signup (`rate-limit.ts:187-194`) | 429 |

> **Verified shape C**, run against the repo's `zod@3.25.76`:
> ```json
> {"success":false,"error":{"issues":[{"code":"too_small","minimum":3,"type":"string",
>  "inclusive":true,"exact":false,"message":"String must contain at least 3 character(s)",
>  "path":["a"]}],"name":"ZodError"}}
> ```
> Note there is **no top-level `message`**. The web client's error reader
> (`client.ts:167-172`) does `payload.message ?? response.statusText`, so every
> request-validation failure currently surfaces to the user as the bare HTTP
> status text. The iOS decoder must handle A, C, D, and D′ separately or it will
> show empty error alerts.

**Recommended iOS error decoder** (union, tried in order):

```swift
enum APIErrorBody {
  case standard(code: String, message: String, details: JSONValue?)   // A, B
  case zodValidation(issues: [ZodIssue])                              // C
  case quota(tier: String, current: Int, limit: Int, message: String) // D
  case rateLimited(message: String, retryAfterSeconds: Int?)          // D′, D″
  case opaque(status: Int, raw: String)                               // anything else
}
```

Discriminate on: presence of `success == false` → C; `error == "quota_exceeded"`
→ D; `error == "rate_limited"` → D′/D″; otherwise A/B.

---

### 2.1 `POST /auth/signup`

**Auth:** none. **Workspace header:** ignored.

Request (`auth.ts:28-33`):

| Field | Type | Required | Constraint |
|---|---|---|---|
| `email` | string | yes | trimmed, lowercased, valid email, ≤254 |
| `password` | string | yes | 8–128 |
| `name` | string | no | trimmed, 1–100 |
| `account_type` | `"student" \| "professional"` | no | **default `"professional"`** |

**Success 200 — two mutually exclusive shapes.** This is a divergence the web
client already handles poorly and iOS must handle explicitly.

*New account* (`auth.ts:125-128`):
```json
{ "token": "<jwt>", "user": { "id": "uuid", "email": "…", "name": "…"|null, "is_admin": false } }
```

*Email already registered* — **also HTTP 200**, anti-enumeration by design
(`auth.ts:88-98`):
```json
{ "status": "ok",
  "message": "If this email is new, your account has been created. If you already have an account, sign in instead." }
```

> **Contract note:** the client must branch on the presence of `token`, not on
> the status code. `CLAUDE.md` explicitly forbids "fixing" this — it is
> intentional anti-enumeration.

Side effects: creates the user, a workspace named `"My class"` (student) or
`"Personal"` (professional), and an `admin` membership, in one transaction
(`auth.ts:101-121`).

**Errors:** 400 shape **C** (zValidator); 429 shape **D″** (3 signups/hour/IP,
`rate-limit.ts:34`, `auth.ts:84-85`).

**Not returned:** `avatar_url`, `default_account_type`, `created_at`. The client
must call `GET /account/me` after signup to fill the profile.

### 2.2 `POST /auth/login`

Request (`auth.ts:35-38`): `{ email: string, password: string(1..128) }`.

Success 200 (`auth.ts:161-164`) — identical to the signup success shape:
```json
{ "token": "<jwt>", "user": { "id","email","name","is_admin" } }
```

Errors:
- **401** `{ "error": "invalid_credentials", "message": "Email or password is incorrect" }`
  (`auth.ts:151` and `auth.ts:157`) — **identical for unknown email and wrong
  password.** Intentional; do not try to distinguish them in the UI.
- **429** shape **D″** — 5 attempts / 15 min, keyed on `IP + email`
  (`rate-limit.ts:33`, `rate-limit.ts:179`).
- **400** shape **C**.

`is_admin` in the response is authoritative at issue time only; the server
re-reads the user row on every request (`auth.ts` middleware,
`src/server/api/middleware/auth.ts:49-52`), so an admin flip takes effect without
a token refresh.

### 2.3 `GET /auth/google` → callback (deep-link handoff)

`GET /api/v1/auth/google?account_type=student|professional`
(`auth-google.ts:79-121`) 302s to Google. After consent, the API 302s the browser
to:

```
{APP_URL}/auth/callback#token=<urlencoded jwt>
```
(`auth-google.ts:285`), or on failure to
```
{APP_URL}/auth/callback#error=<code>
```
(`auth-google.ts:75-77`).

Failure codes, exhaustively: `google_sso_unconfigured`, `missing_code`,
`invalid_state`, `token_exchange_failed`, `invalid_nonce`, `email_unverified`,
`invalid_id_token`, `server_error`, plus any raw `error` param Google returns
(`auth-google.ts:136`).

> **iOS impact:** the redirect target is `APP_URL` — the **web** frontend, not a
> custom URL scheme. `ASWebAuthenticationSession` cannot intercept it without a
> registered Universal Link on `APP_URL`. For 1.0 the pragmatic options are
> (a) ship Universal Links for `{APP_URL}/auth/callback`, or (b) ship
> email/password + Sign in with Apple only. **Do not add a `redirect_uri`
> query parameter to `/auth/google`** — it does not read one, and adding an
> unvalidated one would be an open-redirect.

`state` is a 10-minute HS256 JWT with `{nonce, purpose:"google_oauth",
account_type}` (`auth-google.ts:102-106`); the nonce is echoed in and checked
against the ID token (`auth-google.ts:190`). Account linking happens only when
Google reports `email_verified === true` (`auth-google.ts:195`).

### 2.4 `GET /health` · `GET /ready`

**Auth:** none. Mounted at the API root (`index.ts:82`), so the paths are
`/api/v1/health` and `/api/v1/ready`.

`GET /health` → 200, always (`health.ts:25-31`):
```json
{ "ok": true, "service": "echobrief-api", "timestamp": 1754999999999 }
```
`timestamp` is `Date.now()` — **milliseconds since epoch, a number**, not an ISO
string.

`GET /ready` → 200 or **503** (`health.ts:70-78`):
```json
{ "ready": true, "checks": { "database": true, "redis": true },
  "latencies": { "database_ms": 12, "redis_ms": 3 }, "timestamp": 1754999999999 }
```
On failure, the failing key in `checks` is `false` and its `*_ms` key is
**absent from `latencies`** (`health.ts:49-52`) — `latencies` is a partial
dictionary, not a fixed struct. Decode it as `[String: Int]`.

> **No environment marker on either.** The client cannot tell staging from
> production from the response. See §9.3.

### 2.5 `GET /meetings`

**Auth:** required. **Workspace:** resolved (`index.ts:120`). **Rate limit:**
`general` bucket.

Query params (`src/lib/schemas.ts:53-61`, validated at `meetings.ts:251`):

| Param | Type | Default | Constraint |
|---|---|---|---|
| `page` | int | `1` | ≥1, coerced from string |
| `limit` | int | `20` | 1–100 |
| `status` | MeetingStatus | — | one of the 6 enum values |
| `q` | string | — | ≤200, trimmed |
| `tag` | string | — | ≤50 |
| `from` | ISO datetime **with offset** | — | filters `created_at >=` (`meetings.ts:263`) |
| `to` | ISO datetime **with offset** | — | filters `created_at <=` (`meetings.ts:264`) |

Success 200 (`meetings.ts:319-336`):

```jsonc
{
  "items": [{
    "id": "uuid",
    "title": "string",
    "status": "queued|transcribing|analyzing|indexing|complete|failed",
    "duration_sec": 1234,          // int | null
    "tags": ["a","b"],             // never null — coalesced at meetings.ts:325
    "created_at": "2026-08-12T10:00:00.000Z",
    "recorded_at": null,           // string | null — ALWAYS present (meetings.ts:327)
    "processed_at": "…" ,          // string | null
    "action_item_count": 3,        // int, never null
    "participant_count": 2,        // int, never null
    "summary_excerpt": "…"         // string | null
  }],
  "total": 42, "page": 1, "limit": 20
}
```

**Divergences from `MeetingListResponse` (`src/lib/schemas.ts:64-86`):**

| # | Divergence | Zod says | Server does | Authoritative |
|---|---|---|---|---|
| L1 | `recorded_at` optionality | `.nullable().optional()` (`schemas.ts:72`) | always emits the key, `null` when unset (`meetings.ts:327`) | **Server.** iOS may model it as non-optional-but-nullable. |
| L2 | `status` narrowing | `MeetingStatus` enum | typed `string` in the row type (`meetings.ts:272`) and **never `.parse()`d** — the response is hand-built at `meetings.ts:319` | **Server.** A `status` outside the 6 values would pass through. iOS enum must have an `unknown` fallback case. |
| L3 | `summary_excerpt` | name implies truncation | returns the **entire** `summaries.executive` (`meetings.ts:293`), untruncated | **Server.** Budget for multi-KB strings per item on cellular. |
| L4 | Filtering semantics | `from`/`to` read as "meeting date" | filter `created_at` (upload time), **not** `recorded_at` (`meetings.ts:263-264`) | **Server.** |
| L5 | Sort | — | `ORDER BY m.created_at DESC` (`meetings.ts:311`) — `meetings_user_recorded_at_idx` unused | **Server.** |
| L6 | `q` search scope | — | `title ILIKE '%q%'` only (`meetings.ts:265`); the transcript GIN index is unused | **Server.** |
| L7 | List query validation | `MeetingListResponse` | the response is **not** validated against the schema | **Server.** |

`participant_count` is computed with an explicit both-shapes JSONB unwrap
(`meetings.ts:298-307`) — the fix for the double-encoding bug in §3.2.

**Errors:** 401 A; 403 A (`Not a member of this workspace`); 409 A
(`{"error":"no_workspace"}`) when the user has zero workspaces
(`workspace.ts:49`); 400 C on bad query params; 429 D′.

**Performance note for iOS:** the endpoint runs the row query **and** a separate
`COUNT(*)` with the same predicate (`meetings.ts:315-317`). Both hit
`meetings_workspace_created_idx`. Keep `limit` at 20–25; do not request 100.

### 2.6 `GET /meetings/:id`

**Auth:** required. **Workspace:** resolved. **Rate limit:** `general`.

Success 200. The handler spreads the **entire meetings row**
(`meetings.ts:405-412`):

```ts
return c.json({ ...meeting, has_audio, transcript_provided, meeting_score, transcript, summary });
```

and `meeting` came from `SELECT *` (`meetings.ts:349`). So the actual response
is:

```jsonc
{
  // --- every meetings column, verbatim ---
  "id": "uuid",
  "user_id": "uuid",              // NOT in MeetingDetail — leaked
  "workspace_id": "uuid",         // NOT in MeetingDetail — leaked
  "title": "string",
  "audio_key": "u/m/original.m4a",// NOT in MeetingDetail — leaked (internal R2 key)
  "audio_size": "5242880",        // NOT in MeetingDetail — leaked, AND a STRING (BIGINT, §3.6)
  "audio_mime": "audio/mp4",      // NOT in MeetingDetail — leaked
  "duration_sec": 1234,           // int | null
  "language": "en",
  "status": "complete",
  "failure_reason": null,         // declared .optional() in Zod, ALWAYS present here
  "visibility": "private",
  "share_token": null,
  "tags": [],
  "retry_count": 0,               // declared .optional() in Zod, ALWAYS present here
  "created_at": "…",
  "processed_at": "…"|null,
  "recorded_at": null,            // NOT DECLARED in MeetingDetail at all — but present

  // --- computed ---
  "has_audio": true,              // audio_key !== null && !== ""   (meetings.ts:392)
  "transcript_provided": false,   // provider ∈ {user, assemblyai-streaming} (meetings.ts:402-403)
  "meeting_score": {              // normalized object | null       (meetings.ts:409)
    "total": 8.2, "participation": 7, "actionability": 9,
    "focus": 8, "clarity": 8, "efficiency": 9, "explanation": "…"
  },
  "transcript": {                 // null when no transcripts row
    "raw_text": "…",
    "segments": [{ "speaker": "Maya"|"Speaker A"|null, "start_sec": 0, "end_sec": 12, "text": "…" }],
    "speakers": [{ "id": "A", "label": "Maya", "talk_time_sec": 412.5, "word_count": 980 }]
  },
  "summary": {                    // null when no summaries row
    "executive": "…"|null,
    "key_topics": [], "decisions": [], "open_questions": [],
    "chapters": [{ "title","start_sec","end_sec","summary" }]
  }
}
```

**Divergences from `MeetingDetail` (`src/lib/schemas.ts:205-267`):**

| # | Divergence | Zod (`schemas.ts`) | Migration | Route (`meetings.ts`) | Authoritative |
|---|---|---|---|---|---|
| D1 | `recorded_at` **not declared** | absent from `MeetingDetail` (contrast `MeetingSummary:72`) | column exists (`0011:19`) | present via `SELECT *` → spread (`349`, `406`) | **Route.** iOS *can* read it here; a strict Swift `Codable` will simply ignore it unless modelled. |
| D2 | Six internal columns leak | not declared | — | `user_id`, `workspace_id`, `audio_key`, `audio_size`, `audio_mime`, plus `retry_count`/`failure_reason` (declared `.optional()`) | **Route.** Ignore them in the iOS model; do not display `audio_key`. |
| D3 | `meeting_score` typing | strict object with 7 required numeric/string fields (`schemas.ts:224-233`) | free `JSONB` | `coerceJsonObject<Record<string, unknown>>` — **any** object passes (`meetings.ts:409,430-441`) | **Route.** Decode every score sub-field as optional; the worker's shape is not enforced anywhere. |
| D4 | `meeting_score.total` name | `total` | — | analytics reads `total`, and the comment at `analytics.ts:57-58` records that it once read `overall` | **`total`.** |
| D5 | `failure_reason` / `retry_count` | `.optional()` (`schemas.ts:211-212`) | columns exist | always present (`SELECT *`) | **Route.** Non-optional in the iOS model. |
| D6 | `transcript.speakers[].id` | `z.string()` | stored as `speaker_A` by some writers | rewritten on read to the **raw** label `A` (`meetings.ts:555-558`) | **Route.** `id` is the rename key. |
| D7 | `transcript.segments[].speaker` | `.nullable()` | raw label `A` | resolved to the human name, else `"Speaker A"`, else `null` (`meetings.ts:463-467,559`) | **Route.** Never a bare letter. |
| D8 | Response validation | `MeetingDetail` exists | — | **`.parse()` is never called** on this response | **Route.** The schema is aspirational documentation, not a runtime guard. |
| D9 | `has_audio` vs `transcript` | — | — | a live-recorded meeting has `has_audio: true` **and** `transcript_provided: true` (`meetings.ts:174-201`) | Both flags are independent; don't treat them as exclusive. |

**Redundant query:** the handler selects `provider` in a **second** round-trip
(`meetings.ts:397-401`) despite already having queried `transcripts` at line 361
without it. Two DB round-trips where one would do. Not a correctness bug; noted
because meeting detail is the hottest mobile screen.

**Errors:** 404 A `{"error":"http_error","message":"Meeting not found"}`; 401/403/409 as §2.5.

### 2.7 `GET /meetings/:id/status`

Success 200 — this one **is** validated (`MeetingStatusResponse.parse`,
`meetings.ts:719-727`):

```json
{ "id": "uuid",
  "status": "analyzing",
  "progress": { "uploaded": true, "transcribed": true, "analyzed": false, "indexed": false },
  "estimated_seconds_remaining": 60,
  "failure_reason": null }
```

Derivation (`meetings.ts:705-717`):
- `uploaded` = `audio_key !== null`
- `transcribed` = status ∈ {`analyzing`,`indexing`,`complete`}
- `analyzed` = status ∈ {`indexing`,`complete`}
- `indexed` = status === `complete`
- `estimated_seconds_remaining` = `0` when complete, else `max(30, duration_sec/20)`, else `null`

**Divergence S1 — `progress.uploaded` is wrong for pasted transcripts.**
`POST /meetings/from-transcript` never sets `audio_key` (`meetings.ts:123-134`),
so `uploaded` stays `false` forever even after the meeting reaches `complete`.
The client must not render "Upload" as an incomplete step when
`transcript_provided === true`. Zod (`schemas.ts:272-277`) declares all four
booleans required and says nothing about this. **Route is authoritative; the
flag is unreliable.**

**Divergence S2 — the enum is enforced here and nowhere else.** Because
`MeetingStatusResponse.parse()` runs server-side, an out-of-enum `status` throws
a `ZodError` inside the handler → error shape **B** with HTTP **400**, not 500.
Which matters, because of §3.5.

### 2.8 `GET /meetings/:id/audio-url`

Success 200 (`meetings.ts:677-681`):
```json
{ "url": "https://<acct>.r2.cloudflarestorage.com/...&X-Amz-Expires=1800",
  "mime": "audio/mp4"|null,
  "expires_at": "2026-08-12T10:30:00.000Z" }
```
TTL is **1800 s / 30 min** (`meetings.ts:675`).

Errors: **404** for both "meeting not found" and "no audio for this meeting"
(`meetings.ts:672-673`) — distinguish on the `message` string, or better, gate
the call on `has_audio` from the detail response.

`mime` is nullable: a meeting can have an `audio_key` with `audio_mime` NULL if
it was written by a path that didn't set it. **AVPlayer needs the MIME to pick a
decoder for a URL with no file extension** — the R2 key does carry an extension
(`r2.ts:44-47`), so fall back to extension sniffing when `mime` is null.

### 2.9 `POST /meetings/upload-url`

**Auth:** required. **Workspace:** resolved. **Rate limit:** `general`.
**Quota:** `requireTranscriptionQuota` (`index.ts:138`).

Request — `UploadUrlRequest` (`src/lib/schemas.ts:88-113`):

| Field | Type | Required | Constraint |
|---|---|---|---|
| `filename` | string | **yes** | 1–255 |
| `content_type` | `SupportedMime` | **yes** | **9 values only — see §8.4** |
| `size` | int | **yes** | > 0, ≤ 524288000 (500 MB) |
| `duration_sec` | int | no | > 0, ≤ 14400 (4 h) |
| `title` | string | no | 1–200; defaults to `filename` minus extension (`meetings.ts:79`) |
| `language` | string | no | 2–10 chars, **default `"en"`** |
| `tags` | string[] | no | ≤10 items, each ≤50 chars, **default `[]`** |
| `recorded_at` | ISO datetime w/ offset | no | server-sanitized, see below |

`recorded_at` sanitization (`meetings.ts:48-56`): rejected (→ stored NULL) if
unparseable, more than **24 h in the future**, or **before 2000-01-01**.
Rejection is silent — no error, the column just stays NULL.

Success 200 — validated via `UploadUrlResponse.parse` (`meetings.ts:97-104`):
```json
{ "meeting_id": "uuid", "upload_url": "https://…", "audio_key": "…", "expires_at": "…" }
```

**The meeting row is INSERTed before the presign** (`meetings.ts:71-89`), with
`status='queued'`. A meeting therefore exists in the list even if the client
never completes the `PUT`. There is no server-side reaper for these. Section 6
handles this on the client side.

**Presigned PUT contract — critical for iOS.** `createPresignedUploadUrl`
(`r2.ts:64-81`) signs a `PutObjectCommand` with **both `ContentType` and
`ContentLength`**:

```ts
const cmd = new PutObjectCommand({ Bucket, Key: audioKey, ContentType: contentType, ContentLength: contentLength });
const upload_url = await getSignedUrl(getClient(), cmd, { expiresIn: PRESIGN_TTL_SECONDS });
```

- TTL is **3600 s / 1 hour** (`r2.ts:21`).
- Because `ContentType` and `ContentLength` are part of the signed request, the
  `PUT` **must** send `Content-Type` byte-identical to the `content_type` sent to
  `/upload-url`, and a `Content-Length` byte-identical to `size`. Any mismatch →
  **403 SignatureDoesNotMatch** from R2. The web client does exactly this
  (`src/routes/app.upload.tsx:85`), and note it deliberately re-sends
  `file.type` — for iOS, send the *normalized* MIME you sent to the API, not
  whatever `UTType` reports.
- **URLSession implication:** use `uploadTask(with:fromFile:)` so the byte count
  is exact and streamed from disk. Do **not** let URLSession add
  `Transfer-Encoding: chunked` (it will if you use a stream body without a known
  length) — that drops `Content-Length` and breaks the signature.

**Errors:** 400 C; 429 D (quota); 429 D′ (rate limit); 500 A if R2 credentials
are unset (`r2.ts:28-32` throws → `errorHandler` → `{"error":"internal_error"}`).

**Quota gap Q1.** `requireTranscriptionQuota` reads `duration_sec` from the body
(`quota.ts:56`) and computes `Math.ceil(duration_sec / 60)`. `duration_sec` is
**optional** in the schema and the web upload path **never sends it**
(`app.upload.tsx:216-228` omits it), so file uploads are charged **0 minutes**
against the quota. The live-recording path *does* send it
(`app.upload.tsx:144`). iOS should always send `duration_sec` for correctness,
accepting that it makes quota enforcement stricter than the web app's.

### 2.10 `POST /meetings` (confirm upload)

Request: `{ "meeting_id": "uuid" }` (`ConfirmUploadRequest`, `schemas.ts:124-126`).

Success 200 (`meetings.ts:245`): `{ "meeting_id": "uuid", "status": "queued" }`.

Errors: **404** A if the meeting isn't yours / isn't in this workspace;
**400** A `"Meeting has no audio key"` (`meetings.ts:235`).

**Idempotency:** the handler enqueues unconditionally (`meetings.ts:237-243`).
Calling it twice enqueues twice. BullMQ dedupes on job id only if
`enqueueProcessingJob` sets one — see §6.5 for the client-side guard.

### 2.11 `POST /meetings/from-live`

Request — `LiveUploadRequest` (`schemas.ts:156-177`):

| Field | Type | Required | Constraint |
|---|---|---|---|
| `title` | string | yes | 1–200 |
| `transcript_text` | string | yes | ≥1, ≤500 000 chars |
| `audio_key` | string | yes | 1–500 — the `audio_key` from `/upload-url` |
| `audio_size` | int | yes | > 0, ≤ 500 MB |
| `audio_mime` | string | yes | 1–100 — **free-form string, NOT `SupportedMime`** |
| `duration_sec` | int | yes | ≥ 0, ≤ 21600 (6 h) |
| `language` | string | no | default `"en"` |
| `tags` | string[] | no | default `[]` |

Success 200 (`meetings.ts:216`, validated): `{ "meeting_id": "uuid", "status": "queued" }`.

**Divergence F1 — `audio_mime` here is unconstrained but `content_type` on
`/upload-url` is not.** The live flow calls `/upload-url` first to get an
`audio_key`, and *that* call is gated by `SupportedMime`. So the loose validation
on `from-live` buys nothing: iOS still cannot presign an `audio/aac` object. See
§8.4 and §9.1.

**Divergence F2 — `from-live` does not accept or set `recorded_at`.** The
schema has no such field (`schemas.ts:156-177`) and the `INSERT` omits the
column (`meetings.ts:174-190`). This is the case where the recording time is
known *exactly* — it's `now()` minus `duration_sec`. See §3.1.

### 2.12 `POST /meetings/from-transcript`

Request (`schemas.ts:133-142`): `title` (1–200), `transcript_text` (**≥50**,
≤500 000), `language` (default `en`), `tags` (default `[]`).

Success 200: `{ "meeting_id": "uuid", "status": "queued" }`.

`duration_sec` is **estimated** at 150 words/minute, floored at 60 s
(`meetings.ts:118-119`). No audio, no `recorded_at`, `audio_key` NULL.

Out of iOS 1.0 scope unless a "paste transcript" affordance ships.

### 2.13 `PATCH /meetings/:id`

Request — `MeetingPatchRequest`, **`.strict()`** (`schemas.ts:180-186`): any
unknown key → 400 shape C.

| Field | Type | Constraint |
|---|---|---|
| `title` | string | 1–200 |
| `tags` | string[] | ≤**20** items (note: upload caps at 10 — `schemas.ts:104` vs `:183`) |
| `visibility` | `"private" \| "team"` | |

Success 200: `{ "ok": true }` — **always**, even when the meeting doesn't exist
or belongs to someone else. The `UPDATE` is scoped (`meetings.ts:592`) but the
affected-row count is **never checked**. An empty patch object also returns
`{ok:true}` without touching the DB (`meetings.ts:588`).

**Divergence P1: `PATCH /meetings/:id` cannot report 404.** Contrast
`PATCH /action-items/:id`, which has the same blind-spot (`action-items.ts:86-88`),
and `PATCH /flashcards/:id`, which **does** check `result.count === 0` and 404s
(`flashcards.ts:163`). iOS must not treat `{ok:true}` as proof the write landed;
refetch the detail (see §5.4) or accept eventual consistency.

`visibility: "team"` has **no read-side effect anywhere** — no query filters on
it. It is stored and ignored. Do not build UI implying shared-team visibility.

### 2.14 `PATCH /meetings/:id/speakers`

Request — `SpeakerNamesRequest` (`schemas.ts:200-202`):
```json
{ "names": { "A": "Maya", "B": "David", "C": "" } }
```
Key: 1–8 chars (the raw diarization label). Value: trimmed, ≤80 chars.
**An empty/whitespace value deletes the mapping** (`meetings.ts:616-620`) so the
label falls back to `"Speaker A"`.

Success 200 (`meetings.ts:632`): `{ "ok": true, "names": { "A": "Maya", "B": "David" } }`
— the **cleaned** map, blanks removed. Use the echoed map as the new local truth.

Errors, both **404** shape A, distinguished only by message:
- `"Meeting not found"` — not yours / wrong workspace (`meetings.ts:612`)
- `"This meeting has no transcript yet"` — the meeting exists but no
  `transcripts` row (`meetings.ts:628-630`)

The write is a full replace: `SET speaker_names = <cleaned>` (`meetings.ts:624`),
not a merge. **Always send the complete map**, never a delta.

Names are resolved **on read** (`meetings.ts:554-559`); the stored transcript is
never rewritten. So a rename only needs `qk.meeting(id)` invalidated, nothing
else.

### 2.15 `POST /meetings/:id/share`

Request: `{ "enabled": boolean }` (`meetings.ts:778`).

Success 200 (`meetings.ts:791-794`):
```json
{ "share_token": "a1b2…"|null, "share_url": "https://app…/share/a1b2…"|null }
```
`share_url` is built from server-side `APP_URL` (`meetings.ts:790,793`), so the
client must not construct it itself.

Enabling twice generates a **new** token and invalidates the old link
(`meetings.ts:786`) — there is no "already shared, reuse" branch. Warn the user
before re-enabling.

Like §2.13, the `UPDATE` row count isn't checked: a 404-worthy id returns
`{share_token: "…", share_url: "…"}` for a token that was never persisted.
**Divergence P2.**

### 2.16 `DELETE /meetings/:id`

Success 200: `{ "ok": true }`. 404 A if not found (this one **does** check,
`meetings.ts:648`). R2 deletion failure is logged and ignored
(`meetings.ts:651`).

### 2.17 `POST /meetings/:id/retry`

Success 200: `{ "ok": true }`.

Errors (all shape A):
- 404 `"Meeting not found"`
- 400 `"Meeting is not in a failed state"` (`meetings.ts:745-747`)
- 400 `"Maximum retries reached"` — `retry_count >= 3` (`meetings.ts:748-750`)
- 400 `"Audio file no longer available"` — `audio_key` null (`meetings.ts:751-753`)
- 409 `"This meeting is already being processed"` (`meetings.ts:769`) — **but see
  §3.5; this path is broken and will return 500 instead.**

### 2.18 `GET /action-items`

Query (`action-items.ts:16-24`):

| Param | Type | Notes |
|---|---|---|
| `completed` | **literal `"true"` or `"false"`** | Any other value → 400 C. Not a general boolean coercion. |
| `meeting_id` | uuid | |
| `assignee` | string | `assignee_name ILIKE '%…%'` |
| `due_before` | string | raw passthrough into `ai.due_date <= $x` — an invalid date string reaches Postgres and produces a **500**, not a 400 |

Success 200 (`action-items.ts:65`): `{ "items": [ … ] }` — **no pagination, no
`total`.** Every matching action item in the workspace is returned.

Item shape (`action-items.ts:55-58`):
```jsonc
{ "id": "uuid", "meeting_id": "uuid",
  "meeting_title": "Sprint planning",     // ALWAYS present (INNER JOIN, action-items.ts:60)
  "description": "…",
  "assignee_name": "…"|null,
  "assignee_id": null,                    // always null in practice — nothing writes it
  "due_date": "2026-08-20T00:00:00.000Z"|null,  // ← see D-A1
  "completed": false,
  "timestamp_sec": 42|null,
  "export_refs": {},                      // ← see D-A2
  "created_at": "…" }
```

**Divergences from `ActionItem` (`schemas.ts:286-298`):**

| # | Divergence | Zod | Server | Authoritative |
|---|---|---|---|---|
| A1 | `due_date` format | `z.string().nullable()` — silent on format | Column is **DATE**; postgres.js parses oid 1082 with `parse: x => new Date(x)` (`node_modules/postgres/src/types.js:28-32`) → JSON.stringify emits **`"2026-08-20T00:00:00.000Z"`** | **Server.** Parse as ISO-8601 datetime, then take the **UTC** calendar date. Rendering it in the device timezone shifts it a day west of UTC. On write, send `"2026-08-20"` — Postgres accepts the date-only form. |
| A2 | `export_refs` type | `z.record(z.string()).default({})` | JSONB; may deserialize to a **string** rather than an object after an export write (§3.2, `action-items.ts:132`) | **Server.** Decode defensively: `[String:String]`, else `String`, else empty. |
| A3 | `meeting_title` optionality | `.optional()` (`schemas.ts:289`) | always present — INNER JOIN | **Server.** Non-optional in iOS. |
| A4 | `assignee_id` | `uuidSchema.nullable()` | always `null` | **Server.** Don't build assignee-linking UI in 1.0. |
| A5 | Response validation | `ActionItem` array | not validated | **Server.** |
| A6 | Ordering | undeclared | `ORDER BY ai.due_date NULLS LAST, ai.created_at DESC` (`action-items.ts:62`) | **Server.** |

### 2.19 `PATCH /action-items/:id`

Request — `ActionItemPatchRequest`, **`.strict()`** (`schemas.ts:301-308`):
`description` (1–500), `assignee_name` (≤100, nullable), `due_date` (string,
nullable), `completed` (bool). Unknown keys → 400 C.

Success 200: `{ "ok": true }` — see Divergence P1; row count not checked
(`action-items.ts:86-88`).

Setting `completed` also sets `completed_at` server-side
(`action-items.ts:79-82`) — but `completed_at` is never returned by any endpoint,
so the client cannot display it.

### 2.20 `DELETE /action-items/:id`

Success 200 `{ "ok": true }`. **404** A when `result.count === 0`
(`action-items.ts:99`) — this endpoint *does* check.

### 2.21 `POST /meetings/:id/chat` (streaming)

**Rate limit:** *both* `general` (via `/meetings/*`, `index.ts:96`) **and** `ai`
(`index.ts:107`) — each chat message decrements two buckets.
**Quota:** `requireAIQueryQuota` (`index.ts:140`).

Request — `MeetingChatRequest` (`schemas.ts:324-327`):
```json
{ "message": "string 1..2000", "history": [ { "role": "user"|"assistant", "content": "…" } ] }
```
`history` ≤ **20** entries, default `[]`. Older turns must be dropped client-side.

Success 200: `content-type: text/plain; charset=utf-8`, `cache-control:
no-cache`, `x-accel-buffering: no` (`chat.ts:52-54`), body = raw UTF-8 token
stream (`chat.ts:56-67`). **Not SSE. Not JSON. No terminator sentinel.** The
stream ends when the connection closes.

Errors (all **before** the stream opens, so they are ordinary JSON):
- 404 A `"Meeting not found"`
- 400 A `"Meeting is still processing. Try again once it's complete."` — status must be exactly `complete` (`chat.ts:33-37`)
- 400 A `"No transcript available for this meeting"` (`chat.ts:38-40`)
- 429 D (quota) / D′ (rate limit)

**Mid-stream failure has no error frame.** If the upstream LLM fails after the
first byte, the client sees a truncated body and a normal EOF. Treat an
abnormally short stream as a soft failure and offer retry.

`logAIQuery` runs **before** the stream is written (`chat.ts:50`), so a stream
that fails at byte 1 still consumes quota.

### 2.22 `POST /search` (streaming + citations header)

**Rate limit:** `ai` (`index.ts:105`). **Quota:** `requireAIQueryQuota`.
**Workspace:** required.

Request — `SearchRequest` (`schemas.ts:333-337`): `query` (1–500), `history`
(≤20, default `[]`), `limit` (1–20, **default 10**).

Success 200: `content-type: text/plain`, plus
`x-citations: <urlencoded JSON array>` (`search.ts:114`). Decode with
`removingPercentEncoding` then JSON.

Citation shape (`search.ts:86-93`, matching `SearchCitation` `schemas.ts:340-347`):
```json
{ "meeting_id": "uuid", "meeting_title": "…", "start_sec": 0, "end_sec": 30,
  "excerpt": "first 300 chars", "similarity": 0.47 }
```
`start_sec`/`end_sec` are `?? 0` coalesced from nullable columns
(`search.ts:89-90`). `similarity` is a float in roughly `(0.25, 1.0]` — the floor
is 0.25 (`search.ts:69`), **not** the 0.5 in the RPC.

**No-results path** (`search.ts:75-84`) — also **HTTP 200**:
- `content-type: text/plain`
- `x-citations: %5B%5D`
- body: the literal sentence
  `"I couldn't find relevant context for that question in your meetings."`

The client must detect "no results" by an **empty citations array**, not by
status code or by string-matching the body.

### 2.23 `GET /workspaces`

**Auth:** required. **Workspace header:** *not* required — this route is mounted
**above** `requireWorkspace` on purpose (`index.ts:113-114`), so it works when
the stored workspace id is stale.

Success 200 (`workspaces.ts:55`):
```json
{ "items": [ { "id","name","color","kind","owner_id","created_at" } ] }
```
`ORDER BY w.created_at ASC` — **`items[0]` is exactly the workspace the server
will pick when `X-Workspace-Id` is absent** (`workspace.ts:41-47` uses the same
ordering). That equivalence is the client's default-selection rule.

`color` is one of 6 values, `kind` one of 2 (§1.4). Neither is validated on
read — they come straight from the column.

`POST /workspaces` returns **201** with the created row (`workspaces.ts:77`) —
the only 201 in the whole API. `PATCH`/`DELETE` return `{ok:true}`; both check
ownership and 404 properly (`workspaces.ts:87-92`, `112-117`).

> **Workspace-quota gap:** `checkWorkspaceQuota` exists
> (`usage-tracker.ts:316-347`) and enforces `free → 1 workspace`, but
> `POST /workspaces` **never calls it**. Free users can create unlimited
> workspaces. Do not surface a "workspace limit" error in 1.0 — it can't fire.

### 2.24 `GET /account/me`

Success 200 (`account.ts:38-42`) — exactly seven fields, `SELECT`ed explicitly:
```json
{ "id","email","name":null,"avatar_url":null,"is_admin":false,
  "default_account_type":"professional"|"student"|null,"created_at" }
```
**`google_id`, `password_hash`, `updated_at` are deliberately not selected.**
The client cannot tell whether the account has a password — which matters,
because `POST /account/password` 400s with `"Account has no password set"`
(`account.ts:69-71`) for Google-only users. Handle that error rather than
pre-gating the UI. (`AdminUserRow` has a `has_password` field
(`hooks.ts:243`) but that's admin-only.)

`PATCH /account/me` — `UpdateProfileRequest`, `.strict()` (`schemas.ts:405-410`):
`name` (1–100), `avatar_url` (https URL | `data:image/(jpeg|png|webp|gif);base64,…`
| `null`, ≤100 000 chars). Returns `{ok:true}`.

> For iOS: resize + JPEG-encode to ~256×256 before base64. The 100 KB cap is on
> the **encoded string** (`schemas.ts:401-403`), and the whole request body is
> additionally capped at 10 MB (`request-limits.ts:19`).

`DELETE /account/me` → `{ok:true}`, irreversible, cascades (§1.5).

### 2.25 `GET /subscription`

Success 200 (`subscription.ts:116-153`):

```jsonc
{
  "subscription": {
    "tier": "free",                    // string, not narrowed on read
    "status": "active",
    "billing_interval": null,
    "current_period_start": null,      // ISO string | null
    "current_period_end": null,
    "price_usd": null,                 // ← STRING | null when set (NUMERIC, §3.6)
    "edu_email_verified": false
  },
  "usage": {
    "period": "2026-08",               // UTC YYYY-MM (usage-tracker.ts:57-62)
    "transcription_minutes": 0,        // int
    "ai_queries_count": 0,
    "flashcards_generated": 0,
    "total_cost_usd": 0,               // Number()-coerced (subscription.ts:131) → real number
    "workspace_count": 1
  },
  "workspace_usage": {
    "transcription_minutes": 0, "ai_queries_count": 0, "flashcards_generated": 0
  },
  "limits": {
    "transcription_minutes": 300|null, // null = unlimited
    "ai_queries": 10|null,
    "flashcards_per_lecture": 3|null,
    "workspaces": 1|null
  },
  "features": {
    "integrations": false, "email_generation": false, "flashcards": false,
    "unlimited_history": false, "shared_workspaces": false,
    "history_retention_days": 30|null
  }
}
```

Limits/features come from `TIER_FEATURES` (`src/lib/features.ts:30-79`) —
hardcoded, not from the DB.

**Divergences:**

| # | Divergence | Declared | Actual | Authoritative |
|---|---|---|---|---|
| SB1 | `price_usd` | `number \| null` (`subscription.ts:75`, and `hooks.ts:251`) | **`string \| null`** — NUMERIC oid 1700 is not in postgres.js's parser table (`node_modules/postgres/src/types.js:4-40`) | **Server.** Decode as `String`, convert with `Decimal`. |
| SB2 | `usage` vs `workspace_usage` | — | `usage` aggregates **all** workspaces; `workspace_usage` is the resolved active one (`subscription.ts:101-104`). Both use the same UTC period. | — |
| SB3 | Workspace resolution | route is outside `requireWorkspace` | it re-implements the resolution inline (`subscription.ts:26-46`) and **silently falls back** to the oldest workspace instead of 403ing on a bad `X-Workspace-Id` | **Server.** A stale header yields *wrong-workspace* numbers here but a 403 everywhere else. |
| SB4 | `usage.total_cost_usd` vs `workspace_usage` | — | `workspace_usage` has **no** cost field | — |
| SB5 | Quota `limit` semantics | — | `TIER_LIMITS.flashcards_per_lecture` is named "per lecture" but `checkQuota` compares it to the **monthly** `flashcards_generated` total (`usage-tracker.ts:295-307`) | **Server.** Free tier is effectively 3 flashcards/month. Out of 1.0 scope. |

`POST /subscription/upgrade` and `/cancel` are **stubs** — `upgrade` returns
`{message, tier, billing_interval, user_id}` with no Stripe call
(`subscription.ts:202-207`). Do not ship purchase UI against them.

### 2.26 `POST /streaming/token`

**Rate limit:** `ai`. **Quota:** `requireTranscriptionQuota` (`index.ts:139`) —
which reads `duration_sec` from the body, and this body has no such field, so it
always evaluates 0 minutes and always passes. **Quota gap Q2.**

Request (optional body, `streaming.ts:21-26`):
```json
{ "expires_in_seconds": 60..600, "max_session_duration_seconds": 60..10800 }
```

Success 200 — passes through `createStreamingToken` verbatim
(`streaming.ts:35`). The web client types it as
(`hooks.ts:183-187`):
```json
{ "token": "…", "ws_url": "wss://…", "expires_at": "…" }
```

The client opens a WebSocket **directly to AssemblyAI** with this token; audio
never transits the EchoBrief API (`streaming.ts:5-7`). For sessions longer than
the token TTL the client re-fetches before expiry (`streaming.ts:9-10`).

### 2.27 `GET /share/:token` (public)

**No auth. No workspace.** Token must match `/^[a-f0-9]{16,64}$/i`
(`share.ts:14`) or **400** A.

Success 200 (`share.ts:49`):
```json
{ "id","title","duration_sec","tags","created_at",
  "executive":null,"key_topics":null,"decisions":null,"open_questions":null,
  "action_items":[{"description","assignee_name","due_date"}] }
```
The summary fields are `null` (not `[]`) when there is no `summaries` row —
they come from a `LEFT JOIN` (`share.ts:35`). **No `chapters`, no transcript, no
`meeting_score`, no `recorded_at`.**

### 2.28 Rate limits & quotas, consolidated

Buckets (`rate-limit.ts:30-55`), sliding window keyed on
`ratelimit:{userId|ip}:{bucket}:{floor(now/window)}`:

| Bucket | free | student | pro | team | Window |
|---|---|---|---|---|---|
| `general` | 100 | 300 | 500 | 2000 | 60 s |
| `ai` | 10 | 50 | 100 | 500 | 60 s |
| `auth` | 5 (all tiers) | — | — | — | 15 min, keyed `IP+email` |
| `signup` | 3 | — | — | — | 60 min, keyed `IP` |

Applied to (from `index.ts:96-111`): `general` → `/meetings/*`,
`/action-items/*`, `/account/*`, `/integrations/*`, `/workspaces/*`,
`/flashcards/*`, `/analytics/*`, `/subscription/*`. `ai` → `/search`,
`/generate/*`, `/meetings/:id/chat`, `/meetings/:id/flashcards/generate`,
`/streaming/*`.

Hono's `/meetings/*` **does** match the bare `/meetings` path — verified
empirically against the repo's Hono version, so `GET /meetings` and
`POST /meetings` are both rate-limited and both workspace-scoped. No gap there.

Quotas (billing-period, `TIER_LIMITS` `usage-tracker.ts:27-52`), free tier only:
300 transcription minutes/month, 10 AI queries/month, 3 flashcards/month, 1
workspace (unenforced). All other tiers are unlimited.

**429 is ambiguous.** Rate limit and quota both return 429 with different
bodies. Discriminate on `error`: `"rate_limited"` → transient, honour
`Retry-After`; `"quota_exceeded"` → durable for the rest of the month, show
upgrade CTA with `tier`/`current`/`limit`.

---

## 3. The `recorded_at` / speaker-names / JSONB landmines

This is a real, previously-observed bug class in this codebase. Four separate
defensive fixes exist in the tree for it (`meetings.ts:295-303`,
`meetings.ts:415-441`, `meetings.ts:537-548`, `analytics.ts:56-70`). What follows
is an audit of the meeting read paths.

### 3.1 `recorded_at` — written on exactly one path, read on exactly one screen

| Path | Sets `recorded_at`? | Citation |
|---|---|---|
| `POST /meetings/upload-url` | **Yes**, sanitized | `meetings.ts:74,87` |
| `POST /meetings/from-live` | **No** — column omitted from the INSERT | `meetings.ts:174-190` |
| `POST /meetings/from-transcript` | **No** | `meetings.ts:123-134` |
| Worker | **No** | grep: no writes in `src/server/workers/` |

| Read | Selects it? | Citation |
|---|---|---|
| `GET /meetings` | Yes | `meetings.ts:291,327` |
| `GET /meetings/:id` | Yes, incidentally via `SELECT *` | `meetings.ts:349,406` |
| `GET /meetings/:id/status` | No (irrelevant) | `meetings.ts:699` |
| `GET /share/:token` | **No** | `share.ts:33` |
| List sort / `from`/`to` filters | **No** — all use `created_at` | `meetings.ts:263-264,311` |

**Finding R1 — schema/route mismatch on the detail endpoint.**
`MeetingSummary` declares `recorded_at` (`schemas.ts:70-72`); `MeetingDetail`
does **not** (`schemas.ts:205-266`). The list route explicitly emits it
(`meetings.ts:327`); the detail route emits it accidentally via `SELECT *`.
**Authoritative: the route.** Both endpoints return it. A strict native `Codable`
that models `MeetingDetail` from the Zod file alone will silently drop a field
that is present on the wire.

**Finding R2 — the one case where the recording time is known exactly is the one
case that doesn't record it.** In-app recording is the primary iOS capture path.
`POST /meetings/from-live` has no `recorded_at` field in its schema
(`schemas.ts:156-177`) and no column in its INSERT (`meetings.ts:174-190`), so
every iOS live recording will land with `recorded_at = NULL` and be dated by
upload time — the exact failure mode `0011_recorded_at.sql:5-8` was written to
prevent. §9.4 proposes the two-line fix.

**Finding R3 — `meetings_user_recorded_at_idx` is dead.** Created at
`0011:22-23` "Listing and calendar-style grouping will sort on this once it is
populated." Nothing sorts or filters on it (`meetings.ts:263-264,311`). Not a
bug; a cost. If iOS ships calendar-style grouping, it must group **client-side**
on `recorded_at ?? created_at`.

**Finding R4 — silent sanitization.** `sanitizeRecordedAt` (`meetings.ts:48-56`)
returns `null` for a value >24 h in the future or <2000-01-01, with **no error
and no field in the response** telling the client it was rejected. iOS cannot
distinguish "the server took my timestamp" from "the server threw it away"
without re-reading the meeting.

### 3.2 JSONB double-encoding — which columns, which reads are defended

The mechanism: postgres.js registers `json.parse = JSON.parse` for oids
`114`/`3802` (`node_modules/postgres/src/types.js:16-21`). If the stored JSONB
value is a **string scalar** (`'"[{...}]"'::jsonb`) rather than an array/object,
`JSON.parse` returns a **JS string**, not the structure. Consumers that call
`.length` on it get the character count; consumers that call `.map` on it crash.

The tree contains three independent bug reports of this in comments:
- `meetings.ts:295-297` — "speakers is stored double-encoded (a JSONB *string*
  holding an array) **for every row the worker has ever written**"
- `meetings.ts:537-540` — "the UI rendered `speakers.length` as the string's
  character count (149 instead of 2)"
- `analytics.ts:59-61` — "`meeting_score` is stored double-encoded"
- and `src/server/workers/processing.ts:74-78` — "postgres.js double-encodes
  objects when bound as text+`::jsonb` … Reads are normalized in
  `src/server/api/routes/meetings.ts` … so this stays compatible with the many
  already-inserted rows in production"

Treat the stored form as **either shape**, per column:

| Column | Written by | Read path | Defended? |
|---|---|---|---|
| `transcripts.content` | `processing.ts:84` | `buildTranscriptResponse` handles string-or-object (`meetings.ts:499-505`) | **Yes** |
| `transcripts.speakers` | `processing.ts:85`; `'[]'::jsonb` literal on the paste/live paths (`meetings.ts:140,196`) | `meetings.ts:541-548` handles both | **Yes** |
| `transcripts.speakers` (count) | same | `jsonb_typeof` array-or-string branch in SQL (`meetings.ts:298-307`) | **Yes** |
| `transcripts.speaker_names` | `meetings.ts:624` | `parseSpeakerNames` handles both (`meetings.ts:469-485`) | **Yes** |
| `summaries.chapters` | `processing.ts:131` | `coerceJsonArray` (`meetings.ts:381-386`, `417-428`) | **Yes** |
| `meetings.meeting_score` | `processing.ts:219` | `coerceJsonObject` (`meetings.ts:409`, `430-441`); SQL branch in analytics (`analytics.ts:64-70`) | **Yes** |
| `summaries.key_topics/decisions/open_questions` | `sql.array()` (`processing.ts:128-130`) | plain TEXT[] | N/A — not JSONB |

**Undefended read paths — two found:**

**Finding J1 — `POST /generate/email` will 500 on a double-encoded `speakers`.**
```ts
// src/server/api/routes/generate.ts:68
const participants = (meeting.speakers ?? []).map((s) => s.label);
```
`meeting.speakers` comes straight from `t.speakers` (`generate.ts:44`) with **no
normalization**. If it deserializes to a JS string, `.map` is not a function →
uncaught TypeError → `errorHandler` → **500** `{"error":"internal_error"}`. This
is the same column and the same failure the transcript path was explicitly fixed
for (`meetings.ts:537-540`). Out of iOS 1.0 scope (email generation is
professional-tier and deferred), but it is a live defect.

**Finding J2 — `POST /action-items/:id/export` spreads a possibly-string
`export_refs`.**
```ts
// src/server/api/routes/action-items.ts:130-132
const newRefs = { ...item.export_refs, [provider]: stubExportId };
await sql`UPDATE action_items SET export_refs = ${JSON.stringify(newRefs)}::jsonb …`;
```
The first export reads the column default `'{}'::jsonb` — a genuine object — so
it works. A **second** export reads back what line 132 wrote; if that landed as a
string scalar, `{...string}` produces `{"0":"{","1":"\"",…}` and the row is
corrupted into per-character keys. Also out of 1.0 scope (export is
professional-tier), but it means **`export_refs` on the wire is not reliably
`[String: String]`** — see Divergence A2.

### 3.3 Fields declared in a schema but not selected by the server

Audit result across the iOS 1.0 surface:

| Field | Declared | Selected/emitted | Verdict |
|---|---|---|---|
| `MeetingDetail.recorded_at` | **not declared** (`schemas.ts:205-266`) | **emitted** (`SELECT *`) | schema under-declares |
| `MeetingDetail.failure_reason` / `.retry_count` | `.optional()` (`schemas.ts:211-212`) | always emitted | schema over-optional |
| `MeetingSummary.recorded_at` | `.optional()` (`schemas.ts:72`) | always emitted | schema over-optional |
| `ActionItem.meeting_title` | `.optional()` (`schemas.ts:289`) | always emitted | schema over-optional |
| `share.ts` response `chapters` | — | **not selected** (`share.ts:33`) | correctly absent |
| `summaries.generated_at` | — | never selected by any client route | correctly absent |
| `action_items.completed_at` | — | written (`action-items.ts:81`) but **never selected** | write-only column |
| `workspaces.logo_url` | — | never selected (`workspaces.ts:49`) | dead column |
| `workspace_members.role` | — | never selected | invisible to clients |
| `users.google_id` | in `UserRow` (`db/types.ts:27`) | **not** in `GET /account/me` (`account.ts:38`) | client can't detect SSO-only accounts |

No field is *declared and then missing* on any iOS-1.0 endpoint. The failures
run the other direction: the schemas **under**-declare what the server sends.
That is the safer direction for a native client, but it means the Zod file is not
a sufficient basis for generating Swift models — the routes are.

### 3.4 Speaker-name resolution rules (exact)

From `meetings.ts:463-467` and `:550-559`:

1. `speakers[].id` stored as `"speaker_A"` is rewritten to `"A"` on read
   (`meetings.ts:556`). **`id` is the key for `PATCH /:id/speakers`.**
2. `speakers[].label` becomes `names[id]` if a non-blank name exists, else
   `"Speaker " + id`, else the stored label (`meetings.ts:557`).
3. Every `segments[].speaker` gets the same treatment
   (`meetings.ts:559`); `null` stays `null` (`meetings.ts:464`).
4. Blank values are dropped at write time (`meetings.ts:616-620`) and at read
   time (`meetings.ts:481-484`) — the map never contains empty strings.

**Client rule:** to render the rename sheet, use `transcript.speakers[].id` as
the stable key and `.label` as the current display value. To detect
"unnamed", test `label == "Speaker \(id)"` — there is no explicit flag.

### 3.5 Bonus landmine — `POST /meetings/:id/retry` writes an illegal status

```ts
// src/server/api/routes/meetings.ts:766-770
if (!queued) {
  await sql`UPDATE meetings SET status = 'processing' WHERE id = ${id}`;
  throw new HTTPException(409, { message: "This meeting is already being processed" });
}
```

`'processing'` is **not** in the CHECK constraint
(`0001:60-61`: `queued|transcribing|analyzing|indexing|complete|failed`). The
`UPDATE` raises `23514 check_violation`, which propagates before the
`HTTPException` is ever constructed → `errorHandler` catches a non-HTTPException
→ **500 `{"error":"internal_error","message":"An unexpected error occurred"}`**,
not the intended 409.

Also note that line 755 has *already* set `status = 'queued'` and cleared
`failure_reason` before the re-enqueue attempt, so a meeting hitting this path
ends up `queued` with no job — permanently stuck out of `failed`, therefore no
longer retryable (`meetings.ts:745-747` requires `failed`).

**Client consequence:** iOS must treat a **500** from `/retry` as "already
processing, poll status" rather than as a crash, and must expect a meeting to sit
in `queued` indefinitely. §9 does not propose fixing this (out of contract
scope), but it must be in the client's error table.

### 3.6 Numeric type landmines — postgres.js parses only *some* integer oids

`node_modules/postgres/src/types.js:10-14` registers number parsing for oids
`[21, 23, 26, 700, 701]` = `int2`, `int4`, `oid`, `float4`, `float8`. **`int8`
(20) and `numeric` (1700) are absent**, so they arrive as **strings** and
serialize into JSON as strings.

| Field | Column type | JSON type | Where it surfaces |
|---|---|---|---|
| `meetings.audio_size` | BIGINT | **string** | leaked in `GET /meetings/:id`; `db/types.ts:52` says `number` — wrong |
| `subscriptions.price_usd` | NUMERIC(10,2) | **string** | `GET /subscription` (`subscription.ts:123`); `hooks.ts:251` says `number` — wrong |
| `usage_logs.total_cost_usd` | NUMERIC(10,6) | **number** | explicitly `Number()`-coerced (`subscription.ts:131`) |
| `pipeline_logs.cost_usd` | NUMERIC(10,6) | **string** | admin only |
| `duration_sec`, `timestamp_sec`, `*_count`, `retry_count` | INTEGER | number | safe |
| analytics `total_meetings`, etc. | cast `::TEXT` then `parseInt` | number | safe (`analytics.ts:132-139`) |

Swift decoding rule: any money or byte-count field gets a
`@LenientNumeric` wrapper that accepts both `String` and `Double`.

### 3.7 Date/time landmines

- TIMESTAMPTZ (oids 1082/1114/1184) → `new Date(x)`
  (`node_modules/postgres/src/types.js:28-32`) → `JSON.stringify` → ISO-8601
  with `Z`. `isoDateSchema` requires `{offset: true}` (`schemas.ts:14`), which
  `Z` satisfies. Safe.
- **DATE (`action_items.due_date`) uses the same parser** — a date-only value
  becomes a `Date` at UTC midnight and serializes as
  `"2026-08-20T00:00:00.000Z"`. Formatting that in `America/Los_Angeles` shows
  **August 19**. Always format `due_date` with `TimeZone(identifier: "UTC")`.
- `health.timestamp` / `ready.timestamp` are **epoch milliseconds as numbers**
  (`health.ts:29,75`), not ISO strings. Different from every other timestamp in
  the API.
- `usage.period` is `YYYY-MM` computed in **UTC** (`usage-tracker.ts:57-62`), so
  quota rollover happens at UTC midnight on the 1st, not local midnight.

---

## 4. Client-side data model for iOS

### 4.1 Principles

1. **Model the route, not the Zod file.** §3.3 shows the schemas under-declare.
2. **Never fail a decode on an unknown enum value.** Every enum gets an
   `unknown(String)` case. `GET /meetings` does not validate `status`
   server-side (Divergence L2).
3. **Parse dates at the boundary**, once, into `Date`. Keep the raw string only
   where round-tripping matters (`due_date` on PATCH).
4. **Widen nothing.** If the server always sends a key, the Swift property is
   non-optional even when Zod says `.optional()`.

### 4.2 Domain types

```swift
// ─── Enums ──────────────────────────────────────────────────────────────────
enum MeetingStatus: RawRepresentable, Codable, Hashable {
    case queued, transcribing, analyzing, indexing, complete, failed
    case unknown(String)                       // L2: never trust the wire
    var isTerminal: Bool { self == .complete || self == .failed }
    /// Drives polling (§5.5) and the offline matrix (§7).
}

enum MeetingVisibility: String, Codable { case `private`, team }
enum WorkspaceKind: String, Codable { case student, professional }
enum WorkspaceColor: String, Codable { case brand, violet, emerald, amber, rose, slate }
enum AccountKind: String, Codable { case student, professional }
enum SubscriptionTier: String, Codable { case free, student, pro, team }
enum SubscriptionStatus: String, Codable { case active, cancelled, past_due, trialing }

// ─── Meetings ───────────────────────────────────────────────────────────────
struct MeetingSummary: Identifiable, Codable, Hashable {
    let id: UUID
    let title: String
    let status: MeetingStatus
    let durationSec: Int?
    let tags: [String]                 // server coalesces; never nil (meetings.ts:325)
    let createdAt: Date
    let recordedAt: Date?              // ALWAYS present as a key; value may be null (L1)
    let processedAt: Date?
    let actionItemCount: Int           // never null
    let participantCount: Int          // never null
    let summaryExcerpt: String?        // NOT truncated server-side (L3)

    // ─── computed ───
    /// The single date the UI shows. R1/R3: server never sorts by this.
    var displayDate: Date { recordedAt ?? createdAt }
    var dateIsExact: Bool { recordedAt != nil }      // drives the "Recorded"/"Uploaded" label
    /// Client-side truncation — L3 means the server sends the whole summary.
    var excerptForList: String? { summaryExcerpt.map { String($0.prefix(180)) } }
}

struct MeetingScore: Codable, Hashable {
    // D3: coerceJsonObject accepts ANY object. Every field is optional.
    let total: Double?
    let participation: Double?
    let actionability: Double?
    let focus: Double?
    let clarity: Double?
    let efficiency: Double?
    let explanation: String?
}

struct TranscriptSegment: Codable, Hashable, Identifiable {
    var id: String { "\(startSec)-\(endSec)" }
    let speaker: String?          // D7: resolved name, or "Speaker A", or nil
    let startSec: Double
    let endSec: Double
    let text: String
}

struct SpeakerStat: Codable, Hashable, Identifiable {
    let id: String                // D6: RAW label ("A") — the rename key
    let label: String             // resolved display name
    let talkTimeSec: Double
    let wordCount: Int

    /// No server flag exists; this is the only way to detect an unnamed voice.
    var isNamed: Bool { label != "Speaker \(id)" }
}

struct MeetingTranscript: Codable, Hashable {
    let rawText: String
    let segments: [TranscriptSegment]
    let speakers: [SpeakerStat]
}

struct MeetingSummaryBody: Codable, Hashable {
    let executive: String?
    let keyTopics: [String]
    let decisions: [String]
    let openQuestions: [String]
    let chapters: [Chapter]
    struct Chapter: Codable, Hashable { let title: String; let startSec: Int; let endSec: Int; let summary: String }
}

struct MeetingDetail: Identifiable, Codable, Hashable {
    let id: UUID
    let title: String
    let status: MeetingStatus
    let failureReason: String?          // D5: always present, value nullable
    let retryCount: Int                 // D5: always present
    let durationSec: Int?
    let language: String
    let tags: [String]
    let visibility: MeetingVisibility
    let shareToken: String?
    let hasAudio: Bool
    let transcriptProvided: Bool        // D9: independent of hasAudio
    let meetingScore: MeetingScore?
    let transcript: MeetingTranscript?
    let summary: MeetingSummaryBody?
    let createdAt: Date
    let processedAt: Date?
    let recordedAt: Date?               // D1/R1: undeclared in Zod, present on the wire

    // D2: user_id / workspace_id / audio_key / audio_size / audio_mime are on the
    // wire and deliberately NOT modelled. Never surface audio_key.

    var displayDate: Date { recordedAt ?? createdAt }
    var canRetry: Bool { status == .failed && retryCount < 3 && hasAudio }   // meetings.ts:745-753
    var isShared: Bool { shareToken != nil }
}

struct MeetingProgress: Codable, Hashable {
    let id: UUID
    let status: MeetingStatus
    let uploaded: Bool          // S1: unreliable for transcript_provided meetings
    let transcribed: Bool
    let analyzed: Bool
    let indexed: Bool
    let estimatedSecondsRemaining: Int?
    let failureReason: String?

    /// S1 correction. The caller supplies transcriptProvided from the detail cache.
    func steps(transcriptProvided: Bool) -> [(String, Bool)] {
        var s: [(String, Bool)] = [("Uploaded", uploaded || transcriptProvided)]
        if !transcriptProvided { s.append(("Transcribed", transcribed)) }
        s.append(contentsOf: [("Analyzed", analyzed), ("Indexed", indexed)])
        return s
    }
}

// ─── Action items ───────────────────────────────────────────────────────────
struct ActionItem: Identifiable, Codable, Hashable {
    let id: UUID
    let meetingId: UUID
    let meetingTitle: String            // A3: always present
    let description: String
    let assigneeName: String?
    let dueDate: CalendarDate?          // A1: see below
    let completed: Bool
    let timestampSec: Int?
    let exportRefs: [String: String]    // A2: lenient decode, {} on any surprise
    let createdAt: Date
    // A4: assignee_id is always null — not modelled.
}

/// A1: the wire carries "2026-08-20T00:00:00.000Z" for a DATE column.
/// Store the UTC calendar components; render and re-serialize in UTC.
struct CalendarDate: Codable, Hashable {
    let year: Int, month: Int, day: Int
    init?(isoWire: String)            // parses both "2026-08-20" and full ISO, UTC calendar
    var wireValue: String             // "2026-08-20" — what PATCH sends back
    var displayDate: Date             // UTC noon, so DateFormatter in any tz shows the right day
}

// ─── Workspace / account / plan ─────────────────────────────────────────────
struct Workspace: Identifiable, Codable, Hashable {
    let id: UUID; let name: String
    let color: WorkspaceColor; let kind: WorkspaceKind
    let ownerId: UUID; let createdAt: Date
}

struct Account: Identifiable, Codable, Hashable {
    let id: UUID; let email: String
    let name: String?; let avatarURL: String?     // may be a data: URL — not a URL type
    let isAdmin: Bool
    let defaultAccountType: AccountKind?
    let createdAt: Date
    // google_id is NOT returned (§2.24) — the client cannot know if a password exists.
}

struct PlanState: Codable, Hashable {
    let tier: SubscriptionTier
    let status: SubscriptionStatus
    let priceUSD: Decimal?             // SB1: arrives as a STRING
    let currentPeriodEnd: Date?
    let usage: Usage
    let workspaceUsage: WorkspaceUsage
    let limits: Limits
    let features: Features
    struct Usage: Codable, Hashable {
        let period: String             // "YYYY-MM", UTC
        let transcriptionMinutes: Int, aiQueriesCount: Int, flashcardsGenerated: Int
        let totalCostUSD: Double, workspaceCount: Int
    }
    // limits.* are Int? where nil == unlimited (features.ts:44-54)
}

// ─── Search ─────────────────────────────────────────────────────────────────
struct SearchCitation: Codable, Hashable, Identifiable {
    var id: String { "\(meetingId)-\(startSec)" }
    let meetingId: UUID; let meetingTitle: String
    let startSec: Int; let endSec: Int
    let excerpt: String; let similarity: Double
}
```

### 4.3 Transformation table (wire → domain)

| Wire field | Wire type | Domain | Transform |
|---|---|---|---|
| `created_at`, `processed_at`, `recorded_at`, `expires_at` | ISO-8601 w/ `Z` | `Date` | `ISO8601DateFormatter` with `.withFractionalSeconds` **and** a non-fractional fallback (`expires_at` from `r2.ts:79` has ms; `NOW()` values may not) |
| `due_date` | `"…T00:00:00.000Z"` | `CalendarDate` | Parse in UTC, keep Y/M/D. **Never** `Date` in local tz (A1) |
| `health.timestamp` | epoch **ms** number | `Date` | `Date(timeIntervalSince1970: t/1000)` |
| `status` | string | `MeetingStatus` | Known value → case; else `.unknown(raw)` (L2) |
| `price_usd` | **string** or null | `Decimal?` | Lenient numeric decode (SB1) |
| `audio_size` | **string** | — | Not modelled (D2) |
| `export_refs` | object **or string** | `[String:String]` | Try dict; on failure try `JSONDecoder` on the string; else `[:]` (A2/J2) |
| `meeting_score` | object or null | `MeetingScore?` | All sub-fields optional (D3) |
| `summary_excerpt` | full text | `String?` + `excerptForList` | Truncate client-side (L3) |
| `recorded_at` + `created_at` | two fields | `displayDate` + `dateIsExact` | `recorded_at ?? created_at` (R1) — mirrors `app.meetings.tsx:222-224` |
| `speakers[].id` | `"A"` | `SpeakerStat.id` | Already normalized server-side (D6); do **not** strip a `speaker_` prefix again |
| `x-citations` header | urlencoded JSON | `[SearchCitation]` | `removingPercentEncoding` → `JSONDecoder`; `nil` header → `[]` |
| Streaming bodies | raw UTF-8 chunks | `AsyncSequence<String>` | Incremental `String(decoding:)` with a carry buffer for split multi-byte scalars |

### 4.4 Normalization strategy — **hybrid, entity-normalized for meetings only**

**Decision:** a single `MeetingStore` (an `actor` holding
`[UUID: MeetingEntity]`) for meeting identity, wrapped by per-query result caches
that hold **ID lists**, not objects. Everything else (action items, workspaces,
account, plan, citations) stays as plain per-query caches.

**Why, specifically for this API:**

1. **The list and the detail return genuinely different, non-overlapping data.**
   `MeetingSummary` has `action_item_count`, `participant_count`,
   `summary_excerpt` — none of which appear in `MeetingDetail`. `MeetingDetail`
   has `transcript`, `visibility`, `share_token`, `has_audio` — none of which
   appear in the list. A naive normalized store that merges them will keep
   clobbering fields with `nil`. The entity must therefore be a **union with
   independent freshness per fragment**:
   ```swift
   struct MeetingEntity {
       var summaryFragment: MeetingSummary?   // from GET /meetings
       var detailFragment: MeetingDetail?     // from GET /meetings/:id
       var progressFragment: MeetingProgress? // from GET /meetings/:id/status
       var summaryFetchedAt, detailFetchedAt, progressFetchedAt: Date?
   }
   ```
2. **Three endpoints report `status` for the same row** (list, detail, status
   poll) and they drift by seconds. Without a single owner, the detail header,
   the list row, and the progress bar show three different states at once. The
   store resolves `status` by **most-recent fetch wins**, which is the only
   correct rule given the server has no version or ETag on any response.
3. **Mutations return `{ok:true}` with no row-count check** (Divergences P1, P2).
   The client cannot trust a mutation to have landed, so every write is
   optimistic-with-refetch. Optimistic patches must land in exactly one place or
   rollback is unmanageable across N cached list pages.
4. **Action items are the counter-example** and stay denormalized:
   `GET /action-items` is unpaginated (`action-items.ts:65`), returns the whole
   workspace in one array, is filtered entirely server-side, and each item
   carries its own `meeting_title` via JOIN. There is no cross-query identity
   problem to solve, and the existing web client's optimistic
   `setQueriesData` pattern (`hooks.ts:603-619`) ports directly.
5. **Everything is workspace-partitioned.** The store is keyed
   `[WorkspaceID: [UUID: MeetingEntity]]` so a workspace switch is an O(1)
   subtree swap, not a cache purge — and a stale entity can never bleed across
   workspaces the way it would with flat ID keys.

**Non-goal:** no SQLite/Core Data mirror of the server schema in 1.0. The offline
matrix (§7) is read-mostly and the payloads are small enough for an on-disk
codable snapshot of the query cache. Building a second schema doubles the
double-encoding surface for zero 1.0 benefit.

---

## 5. React Query key architecture

The iOS client should use TanStack Query (React Native) or a Swift equivalent
with the same key semantics. Either way, keys are the contract.

### 5.1 The existing `qk` object — verbatim

```ts
// src/lib/api/hooks.ts:33-41
export const qk = {
  account:      ["account", "me"] as const,
  meetings:     (q?: Partial<MeetingListQuery>) => ["meetings", q ?? {}] as const,
  meeting:      (id: string) => ["meeting", id] as const,
  meetingStatus:(id: string) => ["meeting", id, "status"] as const,
  actionItems:  (filters?: Record<string, unknown>) => ["action-items", filters ?? {}] as const,
  integrations: ["integrations"] as const,
  workspaces:   ["workspaces"] as const,
};
```

Keys used in the web client but **not** in `qk` (ad-hoc, a latent bug source):

| Key | Site |
|---|---|
| `["meeting", id, "audio-url"]` | `hooks.ts:454` |
| `["flashcards","meeting",meetingId]` | `hooks.ts:120` |
| `["flashcards","review",limit]` | `hooks.ts:143` |
| `["admin","users"|"meetings"|"queue"|"system"]` | `hooks.ts:284,291,298,324` |

Note `qk.meetingStatus(id)` = `["meeting", id, "status"]` is a **prefix
descendant** of `qk.meeting(id)` = `["meeting", id]`. So
`invalidateQueries({queryKey: qk.meeting(id)})` invalidates the status poll
**and** the audio URL as a side effect. The web client relies on this in
`usePatchMeeting` (`hooks.ts:513-517`) — probably unintentionally, since a title
edit has no reason to re-presign the audio URL.

### 5.2 Mobile extension — workspace scoping is mandatory

**The single most important change.** Today `X-Workspace-Id` is read from
`localStorage` inside `apiRequest` (`client.ts:111-112`) and is **invisible to
the query key**. Switching workspaces therefore returns cached rows from the
previous workspace until something invalidates them. On the web the workspace
switcher fires a full `queryClient.clear()`-style event; on mobile, with disk
persistence and background refetch, that is not survivable.

```ts
type WS = string;  // active workspace uuid, or "_default" when the header is omitted

export const qk = {
  // ── user-scoped (workspace-agnostic) ──────────────────────────────────────
  account:      ["account", "me"] as const,
  workspaces:   ["workspaces"] as const,
  subscription: ["subscription"] as const,

  // ── workspace-scoped ──────────────────────────────────────────────────────
  ws:            (w: WS) => ["ws", w] as const,

  meetingsRoot:  (w: WS) => ["ws", w, "meetings"] as const,
  meetings:      (w: WS, q: Partial<MeetingListQuery> = {}) =>
                   ["ws", w, "meetings", "list", normalizeListKey(q)] as const,
  meetingsInfinite:(w: WS, q: Omit<Partial<MeetingListQuery>, "page"> = {}) =>
                   ["ws", w, "meetings", "infinite", normalizeListKey(q)] as const,

  meeting:       (w: WS, id: string) => ["ws", w, "meeting", id] as const,
  meetingStatus: (w: WS, id: string) => ["ws", w, "meeting", id, "status"] as const,
  meetingAudio:  (w: WS, id: string) => ["ws", w, "meeting", id, "audio-url"] as const,

  actionItemsRoot:(w: WS) => ["ws", w, "action-items"] as const,
  actionItems:   (w: WS, f: ActionItemFilters = {}) =>
                   ["ws", w, "action-items", normalizeFilterKey(f)] as const,

  // ── ephemeral, never persisted to disk ────────────────────────────────────
  search:        (w: WS, query: string) => ["ws", w, "search", query] as const,
  chat:          (w: WS, id: string) => ["ws", w, "meeting", id, "chat"] as const,
};

/// Stable key regardless of property insertion order or omitted defaults.
/// MUST inject the server defaults (page:1, limit:20 — schemas.ts:54-55) so
/// `{}` and `{page:1,limit:20}` are the same cache entry, not two.
function normalizeListKey(q: Partial<MeetingListQuery>) {
  return { page: 1, limit: 20, ...compact(q) };   // keys sorted on serialize
}
```

Rules:
- `"_default"` is the literal workspace key used when no `X-Workspace-Id` is
  sent. It must be **replaced** with the real id as soon as `GET /workspaces`
  resolves `items[0].id` (`workspaces.ts:52` guarantees the ordering matches
  `workspace.ts:44-46`), otherwise the same data caches twice.
- Switching workspaces invalidates **nothing**. It changes `w`, and the whole
  subtree under the old `w` becomes garbage-collectable. This is the entire
  point of prefixing.
- `qk.meetingStatus` and `qk.meetingAudio` remain descendants of `qk.meeting` —
  keep that, but see §5.4 for why audio-url needs an explicit exclusion.

**Pagination.** `GET /meetings` is offset-based (`page`/`limit`,
`meetings.ts:257`) and returns `total`. Use an infinite query keyed on
`meetingsInfinite` with everything *except* `page` in the key; `pageParam` is the
1-based `page`. `getNextPageParam` = `pages.flatMap(p => p.items).count < total
? lastPage.page + 1 : undefined`. Offset pagination over
`ORDER BY created_at DESC` **will duplicate or skip rows** when a new meeting is
created mid-scroll — dedupe by `id` when flattening, and treat that as accepted
1.0 behaviour.

**Polling queries.** Two exist, both self-terminating:

```ts
// meetings list — hooks.ts:428-434
refetchInterval: (q) => q.state.data?.items.some(m => m.status !== "complete" && m.status !== "failed") ? 5000 : false

// meeting status — hooks.ts:469-474
refetchInterval: (q) => { const d = q.state.data;
  if (!d) return 5000;
  return d.status === "complete" || d.status === "failed" ? false : 5000; }
```

Mobile changes required:
- Add `refetchIntervalInBackground: false`. A 5 s poll from a backgrounded app
  burns the `general` rate-limit bucket (100/min on free) and battery.
- Back off: 3 s for the first 30 s, then 5 s, then 15 s after 5 minutes.
  Transcription of a 60-minute meeting takes minutes, and
  `estimated_seconds_remaining` is `max(30, duration_sec/20)`
  (`meetings.ts:712-717`) — for a 1-hour recording that's 180 s.
- Stop on `scenePhase != .active`; resync once on foreground.
- **The list poll and the detail poll overlap.** If a meeting detail is open,
  suppress the list poll — otherwise a single processing meeting costs
  24 req/min against a 100/min budget.

**Ephemeral keys.** `qk.search` and `qk.chat` results must be excluded from disk
persistence: they are streamed text, can be long, and are AI-query-quota-billed
so re-running is not free — but a stale AI answer presented after a cold start is
worse than absent. Keep them in memory only.

### 5.3 Complete invalidation matrix

`W` = active workspace key. "Prefix" means invalidate every key beginning with
that array.

| Mutation | Endpoint | Invalidate | Why |
|---|---|---|---|
| Sign in / sign up | `POST /auth/login\|signup` | **Reset the entire client**, then fetch `qk.workspaces` → `qk.account` | Token identity changed; every key is now a different user's data |
| Sign out | — | **Reset the entire client**; wipe disk cache | Same |
| Google callback token accepted | — | Same as sign in | Same |
| Switch workspace | (client-side) | Nothing. Change `W`; optionally `removeQueries(["ws", oldW])` after a grace period | The prefix already segregates. §5.2 |
| Create workspace | `POST /workspaces` | `qk.workspaces` | New row in the list |
| Rename / recolor workspace | `PATCH /workspaces/:id` | `qk.workspaces` | Route returns `{ok:true}` only, no row |
| Delete workspace | `DELETE /workspaces/:id` | `qk.workspaces`; `removeQueries(qk.ws(deletedId))` | The subtree is now unreachable |
| **Request upload URL** | `POST /meetings/upload-url` | `qk.meetingsRoot(W)` **prefix** | A `queued` meeting row already exists (`meetings.ts:71-89`) even before the PUT — it must appear in the list |
| Confirm upload | `POST /meetings` | `qk.meetingsRoot(W)` prefix; `qk.meetingStatus(W, id)` | Status transitions to a job-backed `queued` |
| Save live recording | `POST /meetings/from-live` | `qk.meetingsRoot(W)` prefix; `qk.subscription` | New meeting; transcription minutes consumed |
| Save pasted transcript | `POST /meetings/from-transcript` | `qk.meetingsRoot(W)` prefix | New meeting |
| Edit title/tags/visibility | `PATCH /meetings/:id` | `qk.meeting(W,id)` **and** `qk.meetingsRoot(W)` prefix — but **not** `qk.meetingAudio` | Title/tags appear in both list and detail. **Fix vs. web:** `hooks.ts:513-517` invalidates `qk.meeting(id)`, whose descendants include `audio-url`, forcing a needless re-presign. Exclude it explicitly. |
| **Rename speakers** | `PATCH /meetings/:id/speakers` | `qk.meeting(W,id)` **only** | Names resolve on read (`meetings.ts:554-559`); nothing else changes. `participant_count` in the list is a **count**, unaffected by names. Matches `hooks.ts:535-538`. |
| Toggle share | `POST /meetings/:id/share` | `qk.meeting(W,id)` | `share_token` lives only on the detail response. The list does not carry it. |
| Delete meeting | `DELETE /meetings/:id` | `qk.meetingsRoot(W)` prefix; `qk.actionItemsRoot(W)` prefix; `removeQueries(qk.meeting(W,id))` | **Web bug:** `hooks.ts:545` invalidates `["meetings"]` only. Action items cascade-delete in the DB (`0001:119`) but the cached list still shows them. |
| Retry meeting | `POST /meetings/:id/retry` | `qk.meeting(W,id)`; `qk.meetingStatus(W,id)`; `qk.meetingsRoot(W)` prefix | Status flips `failed → queued`; the list shows status. **Web bug:** `hooks.ts:553-556` omits the list. |
| Toggle action item | `PATCH /action-items/:id` | Optimistic patch across `qk.actionItemsRoot(W)` prefix; on settle invalidate that prefix **and** `qk.meetingsRoot(W)` prefix if `completed` changed | Filtered queries (`?completed=true`) must re-partition. `action_item_count` in the list counts all items regardless of completion (`meetings.ts:294`), so completion alone does **not** require the list — but description edits don't either. Keep it simple: invalidate the action-items prefix. |
| Delete action item | `DELETE /action-items/:id` | Optimistic removal across `qk.actionItemsRoot(W)` prefix; on settle invalidate it **and** `qk.meetingsRoot(W)` prefix | `action_item_count` **does** change (`meetings.ts:294`) |
| Update profile | `PATCH /account/me` | `qk.account` | |
| Change password | `POST /account/password` | Nothing | No cached state |
| Delete account | `DELETE /account/me` | Reset everything; wipe disk + Keychain | |
| Chat turn completes | `POST /meetings/:id/chat` | `qk.subscription` (debounced ≥60 s) | Consumes AI-query quota (`chat.ts:50`) |
| Search completes | `POST /search` | `qk.subscription` (debounced ≥60 s) | Same (`search.ts:110`) |
| **Status poll observes `complete`** | `GET /meetings/:id/status` | `qk.meeting(W,id)`; `qk.meetingsRoot(W)` prefix; `qk.actionItemsRoot(W)` prefix; `qk.subscription` | The transition is when transcript/summary/action items materialize. **This is missing from the web client entirely** — it relies on the list's own 5 s poll. On mobile, make it an explicit `onSuccess` transition guard (`prev != .complete && next == .complete`) so it fires exactly once. |
| Status poll observes `failed` | same | `qk.meeting(W,id)`; `qk.meetingsRoot(W)` prefix | `failure_reason` and `retry_count` become meaningful |
| 401 from any request | — | Reset everything; route to sign-in | Mirrors `client.ts:156-162` |
| 403 `"not a member of this workspace"` | — | Clear stored workspace id, set `W = "_default"`, refetch `qk.workspaces`, retry **once** | Mirrors the self-heal at `client.ts:137-149`. Do not loop. |

### 5.4 Cache lifetimes

| Key | `staleTime` | `gcTime` | Persist to disk | Rationale |
|---|---|---|---|---|
| `qk.workspaces` | 5 min | 24 h | Yes | Changes rarely; needed at launch to resolve `W` |
| `qk.account` | 5 min | 24 h | Yes | |
| `qk.subscription` | 2 min | 1 h | Yes | Quota counters move |
| `qk.meetings(W,…)` | 30 s | 1 h | **Page 1 only** | Deep pages are cheap to refetch and expensive to store |
| `qk.meeting(W,id)` | 60 s | 6 h | Yes, LRU-capped at ~50 | Full transcripts; can be hundreds of KB each |
| `qk.meetingStatus(W,id)` | 0 | 5 min | No | Polling data, worthless when cold |
| `qk.meetingAudio(W,id)` | **25 min** | 30 min | **No** | URL expires in 30 min (`meetings.ts:675`); the web client already uses 25 min + `refetchOnWindowFocus:false` (`hooks.ts:458-459`). Persisting an expired URL guarantees a broken player on cold start. |
| `qk.actionItems(W,…)` | 30 s | 2 h | Yes | Unpaginated but small |
| `qk.search` / `qk.chat` | n/a | session | **No** | §5.2 |

### 5.5 Polling lifecycle (mobile-specific)

```
detail opens
  └─ status enabled ⟺ !status.isTerminal
       ├─ interval: 3s (0-30s) → 5s (30s-5m) → 15s (>5m)
       ├─ paused when scenePhase != .active
       ├─ suppresses the list poll while mounted
       └─ on transition → .complete   ⇒ fire the §5.3 "observes complete" row, ONCE
          on transition → .failed     ⇒ fire the .failed row
list visible, no detail open
  └─ list poll enabled ⟺ any item !isTerminal   (mirrors hooks.ts:428-434)
```

---

## 6. Local persistence schema

Four stores, chosen by sensitivity and durability requirement.

### 6.1 Keychain — credentials only

| Item | Service / account | Accessibility | Notes |
|---|---|---|---|
| `authToken` | `com.echobrief.auth` / `jwt` | `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` | HS256 JWT, 7-day TTL (`auth.ts:40`). `AfterFirstUnlock` is required for background upload resumption; `ThisDeviceOnly` keeps it out of iCloud Keychain. |
| `authTokenIssuedAt` | same service / `jwt_iat` | same | The JWT `exp` is readable from the payload, but store `iat` too so the client can prompt for re-auth at day 6 instead of failing a background upload at day 7. |

**Never** in Keychain: workspace id, user profile, cached content.

There is **no refresh token and no `/auth/refresh` endpoint.** On `exp`, the user
must re-authenticate. Any 401 (except from `/auth/*`) must clear the token and
the workspace selection and route to sign-in — this mirrors `client.ts:156-162`
exactly.

### 6.2 MMKV / `UserDefaults` — small preferences

| Key | Type | Default | Notes |
|---|---|---|---|
| `activeWorkspaceId` | String? | `nil` | Mirrors the web's `echobrief-active-workspace` (`client.ts:42`). `nil` → omit `X-Workspace-Id`, server picks the oldest (`workspace.ts:41-47`) |
| `lastKnownUserId` | String? | `nil` | If it changes on sign-in, wipe every cache before hydrating |
| `theme` | `light\|dark\|system` | `system` | Mirrors `echobrief-theme` |
| `audioQualityPreference` | enum | `.standard` | Local only |
| `hasCompletedOnboarding` | Bool | `false` | |
| `lastSubscriptionPeriod` | String? | `nil` | The `YYYY-MM` from `GET /subscription`; a change means quota counters reset |

### 6.3 Disk — React Query cache snapshot

A single codable file at
`Library/Caches/echobrief/query-cache-v1-<userId>-<workspaceId>.json`, written
debounced (≥5 s) and on background transition.

- **Versioned filename.** Any model change bumps `v1` → `v2`; the old file is
  deleted, never migrated.
- **Namespaced by user *and* workspace**, so §5.2's prefix guarantee holds across
  process launches.
- **Excluded keys:** `qk.meetingAudio` (expiring URL), `qk.meetingStatus`
  (ephemeral), `qk.search`, `qk.chat`, and any pending mutation state.
- **In `Caches/`, not `Documents/`.** All of it is re-fetchable; iOS may purge it
  and that must be a non-event.
- Set `isExcludedFromBackup = true`.

### 6.4 Filesystem — recorded audio pending upload

**Location:** `Documents/pending-uploads/<localId>.<ext>` —
`Documents/`, **not** `Caches/`, because this is the only copy of the user's
audio until R2 confirms. Excluded from iCloud backup (audio is large; the server
is the durable store once uploaded).

**Queue index:** `Documents/pending-uploads/queue.json`, an atomically-written
array of the record below. Atomic = write to `queue.json.tmp`, `fsync`, rename.
Rewrite after **every** state transition — an app kill between a byte-write and
an index write must never orphan a file.

#### 6.4.1 Pending-upload record

```swift
struct PendingUpload: Codable, Identifiable {
    // ─── identity ────────────────────────────────────────────────────────────
    let id: UUID                       // localId; also the filename stem
    let createdAt: Date
    var updatedAt: Date

    // ─── ownership / routing (a cold start must not guess these) ────────────
    let userId: UUID                   // discard the record if it != current user
    let workspaceId: String            // the X-Workspace-Id in force at capture,
                                       // or "_default". Meetings are workspace-
                                       // partitioned (§1.6) — never re-route.

    // ─── the local file ──────────────────────────────────────────────────────
    let fileURL: URL                   // stored RELATIVE to Documents/; rebuilt at
                                       // load time. iOS rewrites the container UUID
                                       // on reinstall/restore — an absolute URL
                                       // persisted across launches WILL dangle.
    let byteSize: Int                  // EXACT bytes. Signed into the presigned PUT
                                       // as ContentLength (r2.ts:74) — a mismatch is
                                       // a 403 SignatureDoesNotMatch, not a retry.
    let contentType: String            // MUST equal the content_type sent to
                                       // /upload-url. Signed as ContentType (r2.ts:73).
    let durationSec: Int               // sent as duration_sec → quota (Q1)
    let recordedAt: Date               // capture start. Held locally because
                                       // /from-live cannot accept it (R2/F2).
    let sha256: String?                // optional integrity check on resume

    // ─── capture mode ────────────────────────────────────────────────────────
    enum Mode: String, Codable {
        case liveTranscribed           // → POST /meetings/from-live
        case fileImport                // → POST /meetings   (confirm)
    }
    let mode: Mode
    var transcriptText: String?        // liveTranscribed only; ≤500_000 chars
                                       // (schemas.ts:161). Stored in a SIDECAR
                                       // .txt file, not inline in queue.json —
                                       // a 500 KB string per record makes the
                                       // index rewrite (every transition) O(MB).
    var title: String                  // 1..200 (schemas.ts:157)
    var tags: [String]                 // ≤10 (schemas.ts:104)
    var language: String               // default "en"

    // ─── server handles, acquired mid-flight ────────────────────────────────
    var meetingId: UUID?               // from /upload-url (meetings.ts:99)
    var audioKey: String?              // from /upload-url — required by /from-live
    var presignedURL: URL?             // 3600s TTL (r2.ts:21)
    var presignExpiresAt: Date?        // from the response (meetings.ts:102)
    var uploadedBytes: Int             // best-effort progress, for UI only

    // ─── retry / state ───────────────────────────────────────────────────────
    var state: State
    var retryCount: Int                // presign+PUT attempts
    var nextAttemptAt: Date?           // exponential backoff: 2^n * 5s, cap 15 min
    var lastError: String?
    var backgroundTaskIdentifier: String?   // URLSession background task id

    // ─── derived ─────────────────────────────────────────────────────────────
    /// Refresh at 5 minutes remaining, not at 0 — a large PUT on cellular can
    /// outlive a URL signed just before it started.
    var presignIsUsable: Bool {
        guard let e = presignExpiresAt else { return false }
        return e.timeIntervalSinceNow > 300
    }
}
```

#### 6.4.2 State machine

```
                        ┌──────────────┐
      capture done ────►│  recorded    │  file on disk, no server contact yet
                        └──────┬───────┘
                               │ POST /meetings/upload-url
                        ┌──────▼───────┐
              ┌────────►│  presigning  │
              │         └──────┬───────┘
              │       success  │  ↳ store meetingId, audioKey,
              │                │    presignedURL, presignExpiresAt
              │         ┌──────▼───────┐
              │         │  presigned   │
              │         └──────┬───────┘
              │  presign expired│  (presignIsUsable == false)
              │◄────────────────┤
              │                 │ PUT <presignedURL>
              │          ┌──────▼───────┐
              │          │  uploading   │◄─── background URLSession resumes here
              │          └──┬────┬──────┘         after a cold start
              │   403 sig    │    │ 2xx
              │   mismatch   │    │
              │◄─────────────┘    │
              │   (re-presign)    │
              │            ┌──────▼───────────┐
              │            │    uploaded      │  bytes are in R2
              │            └──────┬───────────┘
              │                   │ mode == .liveTranscribed → POST /meetings/from-live
              │                   │ mode == .fileImport      → POST /meetings
              │            ┌──────▼───────────┐
              │            │   registering    │
              │            └──┬───────────┬───┘
              │        5xx /  │           │ 2xx
              │        network│           │
              │       ┌───────▼──────┐    │
              └───────┤   retrying   │    │
       backoff elapsed└───────┬──────┘    │
                              │ retryCount > 6
                       ┌──────▼───────┐   │
                       │   failed     │   │   terminal; user-visible, manual retry,
                       └──────┬───────┘   │   file RETAINED
                    user deletes│          │
                       ┌────────▼──────────▼──┐
                       │      completed       │  delete local file + sidecar,
                       └──────────────────────┘  drop the record, invalidate
                                                 qk.meetingsRoot(W)
```

**Transition rules that matter for correctness:**

| From → To | Trigger | Guard |
|---|---|---|
| `recorded → presigning` | network available | Must send `duration_sec` (Q1) and `size == byteSize` |
| `presigning → presigned` | 200 from `/upload-url` | **A `meetings` row now exists server-side** (`meetings.ts:71-89`). It will appear in the list as `queued`. If the user abandons here, that row is orphaned — the client must either complete or `DELETE /meetings/:id`. |
| `presigned → uploading` | `presignIsUsable` | Otherwise → `presigning`. **Re-presigning creates a *second* meeting row** — the endpoint always inserts a new one. So on re-presign, `DELETE` the previous `meetingId` first. This is the sharpest edge in the whole flow. |
| `uploading → uploaded` | HTTP 2xx from R2 | |
| `uploading → presigning` | HTTP 403 from R2 | Signature mismatch: byte count or content type drifted. Recompute `byteSize` from disk before retrying. |
| `uploaded → registering` | — | `.fileImport` → `POST /meetings {meeting_id}`; `.liveTranscribed` → `POST /meetings/from-live` with `audio_key`, `audio_size`, `audio_mime`, `duration_sec`, `transcript_text` |
| `registering → completed` | 2xx | Delete the local file **only here** |
| `registering → retrying` | 5xx / offline | |
| `registering → failed` | **400 or 404** | 4xx is not retryable: the body was rejected or the meeting is gone. Surface the message. |
| `* → failed` | `retryCount > 6` | Keep the file. Offer "Retry" and "Save to Files". |

**Cold-start recovery, in order:**

1. Load `queue.json`; drop records where `userId != currentUserId`.
2. Rebuild every `fileURL` from the relative path — never trust a persisted
   absolute URL.
3. For each record, `FileManager.attributesOfItem` → if the file is missing, mark
   `failed` with `"local audio file missing"`; if `byteSize` disagrees with disk,
   **trust disk** and re-presign.
4. Reattach to the background `URLSession` and reconcile: any task the system
   completed while the app was dead advances `uploading → uploaded`.
5. For records in `presigned`/`uploading` whose `presignIsUsable == false`:
   `DELETE /meetings/:id` for the stale `meetingId`, then → `presigning`.
6. For records in `uploaded`/`registering`: resume the registration call.
   **`POST /meetings` (confirm) is not idempotent** (`meetings.ts:237-243`
   enqueues unconditionally) — before re-confirming, `GET /meetings/:id/status`;
   if `status != "queued"` or any progress flag is true, treat it as already
   registered and go to `completed`.

**Storage guardrails:** cap the pending directory at 2 GB; refuse new recordings
above that with a clear message. Show total pending size in Settings. Never
auto-delete a `failed` record's audio.

### 6.5 What is deliberately *not* persisted

| Not persisted | Why |
|---|---|
| Streamed chat/search answers | Quota-billed, stale-dangerous (§5.2) |
| Presigned **read** URLs (`/audio-url`) | 30-min TTL (`meetings.ts:675`) |
| AssemblyAI streaming tokens | ≤600 s TTL (`streaming.ts:23`), single-session |
| `x-citations` payloads | Belong to a specific answer |
| Any `password` field | Ever, anywhere |

---

## 7. Offline capability matrix

Honest position: **EchoBrief is an online product with an offline capture
buffer.** Everything valuable — transcription, summary, action items, search,
chat — is server-computed. The one thing that genuinely must work offline is
*capturing audio you cannot recapture*. Everything else is cache-warming.

| Screen | Readable offline | Writable offline | Conflict / reconciliation rule |
|---|---|---|---|
| **Sign in / Sign up** | No | No | No offline path. There is no refresh token; an expired JWT means online re-auth. Show a network-required state. |
| **Meetings list** | **Yes** — last-persisted page 1 for the active workspace (§6.3) | No | Read-only replay. Show a "Last updated <relative>" banner. Deeper pages are not persisted; scrolling past page 1 offline shows an inline "connect to load more". |
| **Meeting detail** | **Yes** for the ~50 LRU-cached details | Title/tags: **queued** (see below) | Server has no ETag/`updated_at` on meetings, so **last-write-wins with no detection**. `PATCH` returns `{ok:true}` without a row count (Divergence P1), so the client cannot even confirm the write. Queue at most one pending patch per meeting; on reconnect send it, then **refetch the detail and take the server's value verbatim** — never merge. |
| **Transcript view** | **Yes** if the detail is cached (transcript ships inside it) | n/a | Read-only. |
| **Speaker rename** | Cached names visible | **No — do not queue** | The write is a **full replace** of `speaker_names` (`meetings.ts:624`), not a merge. Two offline devices queueing renames would silently clobber each other with no detection possible. Disable the sheet offline with "Renaming needs a connection." Cheap online, dangerous offline. |
| **Audio playback** | **No** for R2-hosted audio (presigned, 30 min, not persisted) — **Yes** for a `pending-upload` file still on disk | n/a | Not worth building a full audio cache for 1.0: files are up to 500 MB, and the server copy is authoritative. If a user wants offline listening, that is a 1.1 "Download" feature with an explicit per-meeting opt-in. |
| **Record (in-app capture)** | **Yes — fully functional offline for audio** | **Yes** | The critical path. **But:** live transcription needs a WebSocket to AssemblyAI (`streaming.ts:5-7`), so offline capture yields **audio only, no transcript**. That means `mode` must fall back from `.liveTranscribed` to `.fileImport` — the recording then goes through `/upload-url` → `PUT` → `POST /meetings` and is transcribed server-side by AssemblyAI batch. **This must be an explicit product decision, and it changes the cost profile** (batch transcription is billed; streaming was already paid for). Show the user "No connection — this will be transcribed after upload." |
| **Import audio file** | Picker works | **Yes** | Enqueue as `.fileImport`; identical machinery. |
| **Upload queue screen** | **Yes** — reads `queue.json` | **Yes** — cancel/retry/delete are all local | Purely local state; no server involvement until online. |
| **Action items** | **Yes** — last-persisted list per workspace | **Yes** — toggle complete, edit text, delete | The single genuinely useful offline write. Reconciliation: **client-wins per field, replay in recorded order.** `PATCH` is `.strict()` and field-granular (`schemas.ts:301-308`), so send only the changed fields. On reconnect: replay → invalidate the prefix → refetch → **server response is truth**. A delete of an item the server already deleted returns 404 (`action-items.ts:99`) — treat 404 on replay of a delete as **success**, not failure. |
| **Chat (per meeting)** | Prior turns **not** cached (§6.5) | **No** | Requires a live LLM stream. Disable with a clear message. Queuing a question to answer later is a 1.1 idea, not 1.0 — the answer would arrive without the user's context. |
| **Search** | **No** | **No** | Requires an embedding call plus pgvector (`search.ts:30,53-73`). A local title-substring search over cached list items is a *different* feature; if you ship it, label it "Searching downloaded meetings" so it is not mistaken for semantic search. |
| **Workspace switcher** | **Yes** — cached, long-lived | Selection: **Yes**, local | Switching offline just re-keys to a subtree that may be empty. Show the empty state honestly. |
| **Settings / profile** | **Yes** — cached `account` + `subscription` | Profile edits: **No** | `PATCH /account/me` is rare and low-value offline; avatar payloads are ≤100 KB base64. Not worth a queue. |
| **Subscription / usage** | **Yes** — cached, stamped stale | No | Quota counters are server-authoritative and move without the client. Always show "as of <time>". Never gate a local action on a cached quota number — let the server return 429 D. |
| **Share toggle** | Cached `share_token` visible | **No** | Enabling twice mints a **new** token and invalidates the old link (`meetings.ts:786`). Queuing that offline could silently break a link the user already sent. |
| **Delete meeting / account** | n/a | **No** | Destructive + cascading (§1.5). Requires confirmation against a live server. |

### 7.1 Where offline is explicitly not worth building for 1.0

- **Full offline audio library.** 500 MB ceiling per file, presigned 30-min
  URLs, no CDN-cacheable public URL in the contract. Ship an explicit
  per-meeting "Download" in 1.1 instead.
- **Offline search of any kind that implies semantics.** No local embeddings, no
  local vector index. Anything less is a lie about the feature.
- **Offline speaker renaming.** Full-replace semantics + no conflict detection
  (see the table). The cost of a wrong merge is a mislabelled transcript the user
  trusts.
- **Offline chat.** No local model, and a deferred answer arrives without the
  user's mental context.
- **A general offline mutation queue.** Only two write paths justify one: the
  pending-upload queue (§6.4) and action-item edits. A generic queue would mean
  building conflict resolution for endpoints that return `{ok:true}` and cannot
  report whether anything changed (Divergence P1).

---

## 8. Enum and constant reference

Exact strings as they appear in the DB CHECK constraints, the Zod enums, and on
the wire. Where any two disagree, that is called out.

### 8.1 Meeting status

`"queued"` · `"transcribing"` · `"analyzing"` · `"indexing"` · `"complete"` · `"failed"`

- DB CHECK: `migrations/0001_initial_schema.sql:60-61`
- Zod: `src/lib/schemas.ts:16-23`
- TS: `src/server/db/types.ts:5-11`

All three agree. **But** `POST /meetings/:id/retry` attempts to write
`'processing'` (`meetings.ts:768`) — not a member. §3.5.

Terminal states: `complete`, `failed` (this is the polling stop condition,
`hooks.ts:431,472`).

### 8.2 Meeting visibility

`"private"` · `"team"` — `0001:63-64`, `schemas.ts:26`, `db/types.ts:13`.
Stored and never read by any query. Do not build team-visibility UI.

### 8.3 Account kind / workspace kind

`"student"` · `"professional"`

- `users.default_account_type` — `0007:27-28` (nullable)
- `workspaces.kind` — `0007:19-20` (NOT NULL, default `'professional'`)
- Signup body `account_type` — `auth.ts:32`, default `"professional"`
- Google `?account_type=` — `auth-google.ts:96-97`, anything ≠ `"student"` → `"professional"`

The **workspace's** `kind` is what gates features server-side
(`workspace.ts:65-79`, `flashcards.ts:38-42`). `users.default_account_type` is a
signup memory only. Signup creates a workspace named `"My class"` (student) or
`"Personal"` (professional) — `auth.ts:101`, `auth-google.ts:248`.

### 8.4 Supported MIME types — **and the iOS AAC problem**

`SupportedMime` (`src/lib/schemas.ts:29-39`), exhaustively, nine values:

```
audio/mpeg   audio/wav   audio/x-wav   audio/mp4   audio/m4a
audio/x-m4a  audio/webm  video/mp4     video/webm
```

The same nine, and only these nine, map to a file extension
(`src/server/services/r2.ts:50-60`); anything else would fall to `"bin"` — but
cannot, because `UploadUrlRequest.content_type` is the enum
(`schemas.ts:90`).

| MIME | Extension | `r2.ts` line |
|---|---|---|
| `audio/mpeg` | `mp3` | 51 |
| `audio/wav` / `audio/x-wav` | `wav` | 52-53 |
| `audio/mp4` / `audio/m4a` / `audio/x-m4a` | `m4a` | 54-56 |
| `audio/webm` | `webm` | 57 |
| `video/mp4` | `mp4` | 58 |
| `video/webm` | `webm` | 59 |

**Absent: `audio/aac` and `audio/x-caf`.**

This is a genuine blocker, not a nit:

- `AVAudioRecorder` with `kAudioFormatMPEG4AAC` in an `.m4a` container is the
  standard iOS recording setup. `UTType.mpeg4Audio.preferredMIMEType` returns
  **`audio/mp4`** — which **is** in the enum. So the *default* iOS recording
  path works.
- The failure cases are: (a) **raw ADTS AAC** (`.aac`), whose UTI maps to
  `audio/aac`; (b) **Core Audio Format** (`.caf`), which
  `AVAudioEngine`-based recorders commonly write and which maps to
  `audio/x-caf`; (c) any file the user imports via `UIDocumentPicker` whose UTI
  resolves to `audio/aac`.
- `AVAudioSession`-recorded `.caf` is the natural choice for a recorder that
  needs to survive an interruption mid-write, because CAF has no fixed-size
  header to patch on close. Choosing `.m4a` to satisfy the enum means accepting
  that a hard app kill mid-recording can leave an unplayable file.

**Recommended resolution — two parts, in this order:**

**Part 1 (client, ships regardless):** configure the recorder to produce
`AVFileType.m4a` / `kAudioFormatMPEG4AAC` and send `content_type: "audio/mp4"`.
On the import path, normalize the picked file's UTI to one of the nine — mirror
the web client's extension-fallback table (`app.upload.tsx:64-79`), extended for
iOS UTIs:

```swift
func normalizedMIME(for url: URL, uti: UTType?) -> SupportedMIME? {
    switch uti {
    case .some(.mp3):        return .audioMpeg      // "audio/mpeg"
    case .some(.wav):        return .audioWav       // "audio/wav"
    case .some(.mpeg4Audio): return .audioMp4       // "audio/mp4"   ← .m4a
    case .some(.mpeg4Movie): return .videoMp4       // "video/mp4"
    default: break
    }
    switch url.pathExtension.lowercased() {
    case "mp3":         return .audioMpeg
    case "wav":         return .audioWav
    case "m4a", "mp4":  return .audioMp4
    case "webm":        return .audioWebm
    case "aac", "caf":  return nil                  // ← blocked until Part 2
    default:            return nil
    }
}
```
Because `Content-Type` is **signed into the presigned PUT** (`r2.ts:73`), the
value sent to `/upload-url` and the value on the `PUT` must be byte-identical —
so this normalization must happen **once**, and both calls must use its output.
Do not re-derive from the file at PUT time.

**Part 2 (server, §9.1):** add `audio/aac` and `audio/x-caf` to the enum and the
extension map. Exactly two files change. Until that ships, a user's `.aac` or
`.caf` file is rejected client-side with "Unsupported file type" — which is
honest, but is a real gap for imported voice memos from third-party apps.

**Transcoding is not the answer.** Re-encoding to `.m4a` on device costs battery
and time on a 2-hour recording, and AssemblyAI accepts AAC natively — the enum
is the only thing in the way.

### 8.5 Subscription tier and status

Tier: `"free"` · `"student"` · `"pro"` · `"team"` — `0008:23-24`,
`usage-tracker.ts:17`, `features.ts:30-79`.
Status: `"active"` · `"cancelled"` · `"past_due"` · `"trialing"` — `0008:27-28`.
Billing interval: `"monthly"` · `"annual"` — `0008:35`, `subscription.ts:188`.

`getUserTier` returns `"free"` when there is no `active` row
(`usage-tracker.ts:228-236`) — so a `cancelled` subscription silently degrades to
free-tier limits.

### 8.6 Action item state

There is **no** action-item enum. State is the boolean `completed`
(`0001:125`) plus the never-exposed `completed_at` (`0001:126`,
written at `action-items.ts:81`). The client models exactly two states:
`open` / `done`. Do not invent `in_progress`.

The list filter accepts only the string literals `"true"` and `"false"`
(`action-items.ts:17-20`) — not `1`/`0`, not `yes`/`no`.

### 8.7 Workspace color and member role

Color: `"brand"` · `"violet"` · `"emerald"` · `"amber"` · `"rose"` · `"slate"`
— `0006:25-26`, `workspaces.ts:18`.
Role: `"admin"` · `"member"` · `"viewer"` — `0001:39`. **Never exposed by any
endpoint** (§1.3). Do not model it.

### 8.8 Other enums the client may encounter

| Enum | Values | Source |
|---|---|---|
| Flashcard difficulty | `easy`, `medium`, `hard` | `0007:38` |
| Integration provider | `notion`, `linear`, `jira`, `google_calendar`, `trello` | `0001:167`, `schemas.ts:41-47` |
| Email type | `meeting_recap`, `stakeholder_update`, `sprint_summary`, `action_item_assignment` | `schemas.ts:369-374` |
| Email tone | `professional`, `casual` (default `professional`) | `schemas.ts:379` |
| Chat role | `user`, `assistant` | `schemas.ts:320` |
| Transcript provider | `assemblyai`, `user`, `assemblyai-streaming` (column default `deepgram`, never written) | `processing.ts:87`, `meetings.ts:143,199`, `0001:92` |
| Google SSO error codes | `google_sso_unconfigured`, `missing_code`, `invalid_state`, `token_exchange_failed`, `invalid_nonce`, `email_unverified`, `invalid_id_token`, `server_error` | `auth-google.ts` (§2.3) |
| API error codes | `unauthorized`, `forbidden`, `no_workspace`, `invalid_credentials`, `rate_limited`, `quota_exceeded`, `validation_error`, `http_error`, `internal_error` | §2.0.1 |

### 8.9 Numeric constants the client must mirror

| Constant | Value | Source |
|---|---|---|
| Max upload size | 500 MB (`524_288_000`) | `schemas.ts:95` |
| Max upload duration | 4 h (`14400 s`) | `schemas.ts:100` |
| Max live-recording duration | 6 h (`21600 s`) | `schemas.ts:174` |
| Max transcript text | 500 000 chars | `schemas.ts:139,162` |
| Max chat message | 2 000 chars | `schemas.ts:325` |
| Max chat/search history | 20 turns | `schemas.ts:326,335` |
| Max search query | 500 chars | `schemas.ts:334` |
| Search result limit | 1–20, default 10 | `schemas.ts:336` |
| List page limit | 1–100, default 20 | `schemas.ts:55` |
| Tags on upload / on patch | ≤10 / ≤20, each ≤50 chars | `schemas.ts:104` / `:183` |
| Title length | 1–200 | `schemas.ts:102` |
| Avatar payload | ≤100 000 chars | `schemas.ts:401-403` |
| API request body | ≤10 MB → 413 | `request-limits.ts:19` |
| Single header | ≤8 KB → 431 | `request-limits.ts:20` |
| Presigned **upload** TTL | **3600 s** | `r2.ts:21` |
| Presigned **read** TTL | 1800 s | `meetings.ts:675` |
| Streaming token TTL | 60–600 s | `streaming.ts:23` |
| Streaming max session | 60–10 800 s | `streaming.ts:24` |
| JWT TTL | 7 d | `auth.ts:40` |
| OAuth state TTL | 10 min | `auth-google.ts:35` |
| Max meeting retries | 3 | `meetings.ts:748` |
| `recorded_at` future skew | 24 h | `meetings.ts:53` |
| `recorded_at` floor | `2000-01-01T00:00:00Z` | `meetings.ts:37` |
| Password length | 8–128 | `auth.ts:30` |
| Email length | ≤254 | `auth.ts:29` |

---

## 9. Proposed backend contract changes

Four changes, deliberately minimal. Each is additive; none breaks the web client.
Nothing else in this document proposes a change.

### 9.1 Add `audio/aac` and `audio/x-caf` to `SupportedMime`

**Problem.** iOS records AAC natively and `UIDocumentPicker` surfaces `.aac` and
`.caf` files. Neither MIME is in the enum (`schemas.ts:29-39`), so `/upload-url`
400s (shape **C**) before a byte is uploaded. The default `AVAudioRecorder`
`.m4a` path happens to map to `audio/mp4` and works, but any raw-AAC or CAF
source is hard-blocked, and CAF is the safer container for a recorder that must
survive a mid-write app kill (no header to patch on close).

**Exact changes — two files, five lines.**

```ts
// src/lib/schemas.ts:29-39
export const SupportedMime = z.enum([
  "audio/mpeg", "audio/wav", "audio/x-wav",
  "audio/mp4", "audio/m4a", "audio/x-m4a",
  "audio/aac",          // + iOS raw ADTS AAC
  "audio/x-caf",        // + iOS Core Audio Format
  "audio/webm", "video/mp4", "video/webm",
]);
```

```ts
// src/server/services/r2.ts:50-60  — inside extensionFromMime's map
  "audio/aac":   "aac",
  "audio/x-caf": "caf",
```

**Backward compatibility: fully compatible.** Widening a Zod input enum only
accepts more; no existing request becomes invalid. `extensionFromMime` already
has a `?? "bin"` fallback (`r2.ts:61`), so unmapped values never threw. Stored
rows are untouched. The web client's `ACCEPT_MIMES`
(`src/routes/app.upload.tsx:34-44`) is a **separate** hardcoded list and will
simply not offer the new types — no change required there, and no regression.

**Verify:** AssemblyAI accepts both containers before shipping; if it does not,
the correct fix is a worker-side transcode, not a client-side one.

### 9.2 Short-lived web-handoff token for "Open in web app"

**Problem.** iOS will want an "Open in web app" affordance for surfaces not in
1.0 (analytics, integrations, email generation, admin). The only credential the
app holds is the 7-day JWT (`auth.ts:40`). Putting that in a URL means the
long-lived session token lands in Safari history, the pasteboard, and any
`Referer` — the Google SSO route already avoids exactly this by using a URL
fragment (`auth-google.ts:20-23`), and a fragment is not enough for a token with
a 7-day life.

**Proposed endpoint.** New file `src/server/api/routes/handoff.ts`, mounted in
the protected group:

```
POST /api/v1/auth/handoff
  auth: required (Bearer)
  body: { "path": "/app/analytics" }        // optional, must start with "/app"
  200:  { "url": "https://app…/auth/handoff#t=<jwt>", "expires_at": "…" }
```

The handoff JWT is signed with `AUTH_SECRET` exactly as the session token is
(`auth.ts:42-51`) but with `setExpirationTime("120s")` and a
`purpose: "web_handoff"` claim — the same pattern the Google `state` token
already uses (`auth-google.ts:102-106`). The web app exchanges it at
`/auth/handoff` for a normal session; `requireAuth`
(`middleware/auth.ts:33`) must reject any token carrying `purpose` so a handoff
token can never be replayed as an API credential.

**Files that change:**
1. `src/server/api/routes/handoff.ts` — new, ~40 lines.
2. `src/server/api/index.ts` — one `protectedApi.route("/auth", handoffRoutes)`
   line near `:145`.
3. `src/server/api/middleware/auth.ts` — after `:33`, reject tokens with a
   `purpose` claim (3 lines). **This is the security-critical edit.**
4. `src/routes/auth.handoff.tsx` — new frontend route that reads the fragment,
   calls `setAuthToken`, and redirects.

**Backward compatibility: additive and safe.** No existing endpoint changes
shape. The `middleware/auth.ts` edit is the only touch to a hot path, and it is a
pure rejection of a claim no currently-issued token carries — existing sessions
verify unchanged. **Do not ship this without the step-3 rejection**; without it,
a 120-second token is a full API credential for 120 seconds, which is worse than
nothing because it invites reuse.

### 9.3 Environment marker on `/health`

**Problem.** `GET /health` returns `{ok, service, timestamp}` (`health.ts:26-30`)
with nothing distinguishing staging from production. A TestFlight build pointed
at the wrong `API_URL` is indistinguishable from a correct one, and a support
report cannot pin the deployment. Every other signal the client could use
(`APP_URL`, `NODE_ENV`) lives only in `/admin/system`, which requires `is_admin`.

**Exact change — one file, three lines.**

```ts
// src/server/api/routes/health.ts:25-31
app.get("/health", (c) => {
  const env = getEnv();
  return c.json({
    ok: true,
    service: "echobrief-api",
    environment: env.NODE_ENV,                       // "development"|"production"|"test"
    api_version: "v1",
    build: process.env.RAILWAY_GIT_COMMIT_SHA ?? null,
    timestamp: Date.now(),
  });
});
```
`NODE_ENV` is already Zod-validated to those three values (`src/server/env.ts:11`)
and `getEnv` is already imported by sibling routes.

**Backward compatibility: fully compatible.** Purely additive keys on an
unauthenticated liveness probe. Railway's healthcheck only reads the status code.
No secrets: `NODE_ENV` and a commit SHA are not sensitive. Note this deliberately
does **not** expose `APP_URL` or `DATABASE_URL` — `/admin/system` already covers
that behind `requireAdmin` (`hooks.ts:310-318`).

**Client use:** call once at launch, cache for the session, show the environment
in Settings → About for any non-production value, and refuse to run a Debug build
against `environment == "production"` without an explicit override.

### 9.4 Accept `recorded_at` on `POST /meetings/from-live`

**Problem — the sharpest one in this document.** `migrations/0011_recorded_at.sql:5-8`
exists precisely so a meeting is dated by when the conversation happened, not
when it was uploaded. But `recorded_at` is written on exactly **one** path,
`/upload-url` (`meetings.ts:74,87`), from a *best-effort, explicitly untrusted*
`File.lastModified`. The one path where the recording time is known **exactly** —
in-app live recording — has no `recorded_at` field in its schema
(`schemas.ts:156-177`) and omits the column from its INSERT
(`meetings.ts:174-190`).

On iOS, live recording is the *primary* capture path. Without this change every
recording made in the app lands with `recorded_at = NULL` and falls back to
upload time — reproducing the exact failure `0011` was written to prevent, and
leaving `meetings_user_recorded_at_idx` (`0011:22-23`) permanently dead.

**Exact changes — one file for the schema, one for the route.**

```ts
// src/lib/schemas.ts — inside LiveUploadRequest (after :176)
  /** When the recording STARTED. Known exactly for in-app capture, unlike the
   *  File.lastModified heuristic on /upload-url. Same server-side sanitization. */
  recorded_at: isoDateSchema.optional(),
```

```ts
// src/server/api/routes/meetings.ts:174-190 — add the column + value
      INSERT INTO meetings (
        id, user_id, workspace_id, title, audio_key, audio_size, audio_mime,
        duration_sec, language, tags, status, recorded_at
      ) VALUES (
        …,
        'queued',
        ${sanitizeRecordedAt(body.recorded_at)}
      )
```
`sanitizeRecordedAt` already exists at `meetings.ts:48-56` and is already applied
on the `/upload-url` path — reuse it verbatim, no new validation logic.

**Backward compatibility: fully compatible.** The field is optional; the existing
web live-recorder (`app.upload.tsx:164-173`) omits it and continues to store
NULL, exactly as today. No stored row changes. No read path changes — both
`GET /meetings` (`meetings.ts:291,327`) and `GET /meetings/:id` (via `SELECT *`)
already return the column.

**Explicitly out of scope for this change** (each would be a separate,
larger decision):
- Adding `recorded_at` to the declared `MeetingDetail` schema. The route already
  returns it (Divergence D1); declaring it is documentation, and this document
  is the client's contract in the meantime.
- Sorting or filtering the list on `recorded_at` (Findings R3, L4/L5). That
  changes pagination semantics for the existing web client and needs its own
  design.
- A response field reporting that a submitted `recorded_at` was rejected
  (Finding R4).
- Fixing the `'processing'` status write in `/retry` (§3.5) — a real bug, but a
  behaviour fix, not a contract change.
- Fixing the undefended `speakers` read in `/generate/email` (Finding J1) or the
  `export_refs` spread (Finding J2) — both outside iOS 1.0 scope.
