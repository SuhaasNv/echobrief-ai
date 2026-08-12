# EchoBrief AI — iOS 1.0 Technical Requirements Document

| | |
|---|---|
| **Document** | Technical Requirements Document (TRD) |
| **Product** | EchoBrief AI for iOS, version 1.0 |
| **Stack** | Expo SDK 57 / React Native 0.87 (TypeScript), New Architecture |
| **Minimum OS** | iOS 17.0 |
| **Primary test device** | iPhone 15 (A16, 6.1", 6 GB RAM) |
| **Status** | Draft for review — not yet approved for implementation |
| **Date** | 2026-08-12 |
| **Backend** | Existing Hono API, unchanged except for the itemized list in §17 |

### How to read this document

Version numbers were resolved against the npm registry on **2026-08-12** by direct
HTTPS query to `registry.npmjs.org/<pkg>/latest`, not from memory. Behavioural
claims about Expo modules are cited to `docs.expo.dev`. Where I could not verify
something with a primary source, the text says **UNVERIFIED** and names the
experiment that would settle it. Do not treat unverified items as design commitments.

A note on the counterfactual the brief asks for: this document is written for
Expo/React Native. Wherever a decision would come out materially different under
native SwiftUI, there is a callout box marked **▸ SwiftUI divergence**. There are
eleven of them. They are concentrated in the streaming, upload, and audio
sections — which is exactly where React Native is weakest and where the
Expo SDK 57 module surface turns out to save us.

---

## Table of contents

1. [Architecture overview](#1-architecture-overview)
2. [Repo & build layout](#2-repo--build-layout)
3. [Shared code strategy](#3-shared-code-strategy)
4. [Dependency manifest](#4-dependency-manifest)
5. [Auth & session](#5-auth--session)
6. [Networking layer](#6-networking-layer)
7. [Audio subsystem](#7-audio-subsystem)
8. [Upload subsystem](#8-upload-subsystem)
9. [Offline & caching](#9-offline--caching)
10. [State management](#10-state-management)
11. [Error handling & observability](#11-error-handling--observability)
12. [Environments & configuration](#12-environments--configuration)
13. [Security requirements](#13-security-requirements)
14. [Testing strategy](#14-testing-strategy)
15. [CI/CD](#15-cicd)
16. [Performance budgets](#16-performance-budgets)
17. [Backend changes required](#17-backend-changes-required)
18. [Risks & open technical questions](#18-risks--open-technical-questions)

---

## 1. Architecture overview

### 1.1 The one-paragraph version

The iOS app is a **thin, offline-tolerant client over an API that already exists
and will not change shape**. Every byte of intelligence — transcription,
diarization, summarization, embedding, scoring — happens in the existing BullMQ
worker on Railway. The phone does four things the web app cannot do well: it
captures audio from the device microphone, it imports audio from the iOS share
sheet, it survives being backgrounded mid-upload, and it renders a transcript at
60fps under a thumb. Everything else is a rendering of server state.

This matters because it sets the failure posture. The app is never the source of
truth for anything except (a) an in-flight recording that has not yet reached R2,
and (b) the upload queue. Those two are the only pieces of durable local state
that can lose user data, and they get the disproportionate share of the
engineering in §7 and §8. All other local state is a cache and may be discarded
at any time without consequence.

### 1.2 System diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            iPhone (iOS 17+)                                  │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                     EchoBrief.app  (Expo SDK 57 / RN 0.87)             │ │
│  │                                                                        │ │
│  │  ┌──────────────────────────────────────────────────────────────────┐  │ │
│  │  │  UI layer — expo-router file routes, React 19 function comps     │  │ │
│  │  │  (auth) · (tabs)/meetings · meeting/[id] · record · chat · search │  │ │
│  │  └───────────────────────────────┬──────────────────────────────────┘  │ │
│  │                                  │                                     │ │
│  │  ┌───────────────────────────────▼──────────────────────────────────┐  │ │
│  │  │  Server-state layer — TanStack Query v5 + AsyncStorage persister  │  │ │
│  │  │  (≈95% of this is the EXISTING src/lib/api/hooks.ts, reused)      │  │ │
│  │  └───────────────────────────────┬──────────────────────────────────┘  │ │
│  │                                  │                                     │ │
│  │  ┌───────────────────────────────▼──────────────────────────────────┐  │ │
│  │  │  @echobrief/shared  (pure TS — zero platform imports)             │  │ │
│  │  │  · schemas.ts (Zod contracts, byte-identical to web)              │  │ │
│  │  │  · createApiClient({ baseUrl, tokenStore, onUnauthorized, ... })   │  │ │
│  │  │  · qk (query keys) · ApiError · error taxonomy                     │  │ │
│  │  └───────────────────────────────┬──────────────────────────────────┘  │ │
│  │                                  │                                     │ │
│  │  ┌──────────┬──────────┬─────────▼─────────┬───────────┬────────────┐  │ │
│  │  │ Keychain │  Audio   │    Networking     │  Upload   │  Telemetry │  │ │
│  │  │  expo-   │  expo-   │   expo/fetch      │   expo-   │  @sentry/  │  │ │
│  │  │  secure- │  audio   │  (ReadableStream) │   file-   │  react-    │  │ │
│  │  │  store   │          │                   │  system   │  native    │  │ │
│  │  └──────────┴────┬─────┴─────────┬─────────┴─────┬─────┴────────────┘  │ │
│  └───────────────────┼───────────────┼───────────────┼────────────────────┘ │
│                      │               │               │                       │
│         ┌────────────▼──┐   ┌────────▼────────┐  ┌───▼──────────────────┐   │
│         │ AVAudioSession│   │  NSURLSession   │  │ NSURLSession         │   │
│         │  (mic, HW     │   │  (foreground)   │  │ *background config*  │   │
│         │  interrupts)  │   │                 │  │ survives app kill    │   │
│         └───────────────┘   └────────┬────────┘  └───┬──────────────────┘   │
└───────────────────────────────────────┼───────────────┼──────────────────────┘
                                        │               │
                        TLS 1.3 / HTTP/2 │               │ TLS 1.3, single PUT
                                        │               │ signed content-length
     ┌──────────────────────────────────▼───┐   ┌───────▼────────────────────┐
     │  Hono API — Railway                   │   │  Cloudflare R2             │
     │  api-production-5cfb.up.railway.app   │   │  (S3-compatible)           │
     │  /api/v1/*                            │   │  presigned PUT, TTL 3600s  │
     │                                       │   │  NO multipart, NO chunked  │
     │  · Bearer JWT, HS256, sub=user, 7d    │   └───────┬────────────────────┘
     │  · X-Workspace-Id (optional)          │           │
     │  · Hono stream() = chunked plain text │           │ worker reads object
     │  · uniform {error,message,details?}   │           │
     └───┬───────────────────────┬───────────┘           │
         │                       │                       │
    ┌────▼─────────┐   ┌─────────▼──────────┐   ┌────────▼──────────────────┐
    │  Postgres    │   │  Redis             │   │  BullMQ worker            │
    │  + pgvector  │◄──┤  rate-limit,       │──►│  AssemblyAI → GPT-5 →      │
    │  Railway     │   │  quota, queue      │   │  embeddings → score        │
    └──────────────┘   └────────────────────┘   └───────────────────────────┘
```

### 1.3 Module boundaries

The app is cut into six modules. The boundary rule is: **a module may depend on
the layer below it and on `@echobrief/shared`, never sideways and never up.**
Enforced by an ESLint `no-restricted-imports` rule, not by convention.

| Module | Owns | Must not touch | Testable without a device? |
|---|---|---|---|
| `app/` (routes) | Navigation, screen composition, layout | `expo-secure-store`, `expo/fetch` directly | Component tests only |
| `features/` | Screen logic, one folder per 1.0 feature | Native modules directly (goes through `services/`) | Yes, with mocked services |
| `services/` | Native module wrappers (audio, upload, keychain, telemetry) | React, TanStack Query | Partially — needs mocks |
| `lib/query/` | Query client, persister, hook re-exports | Native modules | Yes |
| `@echobrief/shared` | Zod schemas, API client factory, query keys, error taxonomy | **Everything platform-specific.** No `window`, no `localStorage`, no `react-native`, no `expo-*` | **Yes — pure Node, runs in the existing vitest suite** |
| `config/` | Environment resolution, feature flags, build metadata | Anything | Yes |

The load-bearing constraint is the last row. `@echobrief/shared` must remain
importable by Node with no bundler and no shims, because that is what lets the
existing `vitest` suite at the repo root test the mobile app's networking logic
on CI without a simulator (§14, §15). The moment someone imports `react-native`
into shared, that property is gone and the CI story collapses to "EAS Build or
nothing." Treat it as a hard invariant with a CI check.

### 1.4 Data flow — the three paths that matter

**Path A — read a meeting (the 95% case).**

```
Screen mounts
  └─► useMeeting(id)                      [existing hook, unmodified]
        └─► queryClient: cache hit? ──yes──► render immediately (stale-while-revalidate)
              └──no──► apiClient.request('/meetings/:id')
                         ├─ inject Authorization from in-memory token cache  (sync, §5)
                         ├─ inject X-Workspace-Id from client store          (sync)
                         ├─ expo/fetch → HTTPS
                         ├─ 200 → Zod parse → cache → render
                         ├─ 401 → tokenStore.clear() + onUnauthorized()      (§5)
                         ├─ 403 "not a member" → clear workspace, retry once (§6)
                         └─ 429 → classify quota vs rate-limit, back off     (§6)
```

**Path B — record and upload (the risky case).** Detailed in §7 and §8.

```
Tap record
  └─► expo-audio: setAudioModeAsync({allowsRecording, allowsBackgroundRecording})
        └─► AudioRecorder(HIGH_QUALITY)  →  .m4a / MPEG4AAC  →  audio/mp4
              └─► [user may background the app, take a call, get interrupted]
                    └─► stop() → file at Paths.document/recordings/<uuid>.m4a
                          └─► ENQUEUE to local durable upload queue (survives kill)
                                └─► POST /meetings/upload-url  {size: file.size, ...}
                                      └─► PUT to R2 via background NSURLSession
                                            │   content-length MUST equal that same size
                                            └─► POST /meetings  → BullMQ enqueued
                                                  └─► poll status → complete
```

**Path C — streaming chat (the one RN cannot do with stock fetch).** Detailed in §6.4.

```
Send message
  └─► expo/fetch POST /meetings/:id/chat     ← NOT global fetch; import from 'expo/fetch'
        └─► response.body.getReader()        ← this is why expo/fetch is mandatory
              └─► TextDecoder(chunk) → append to a ref → throttled 60ms flush → setState
```

### 1.5 Relationship to the existing backend

The app is **additive and non-breaking**. It speaks the same `/api/v1` surface the
web client speaks, with the same JWT, the same workspace header, and the same
error envelope. The backend changes in §17 are, with one exception, either
additive endpoints or widened enums — nothing the web client can observe.

The exception worth flagging early: the **7-day JWT with no refresh endpoint** is
survivable on web (the user has a keyboard, a password manager, and a tab already
open) and hostile on mobile (the user gets logged out on a train, on a phone,
with a 20-character password they do not remember). §17 recommends adding
`POST /auth/refresh` and rates it the single highest-value backend change. Version
1.0 ships without it if it must, using the pre-emptive re-auth prompt in §5.6, but
that is a mitigation, not a fix.

---

## 2. Repo & build layout

This section carries more risk than it looks like it should, so it gets a real
analysis rather than a recommendation.

### 2.1 The constraint that decides it

The root `package.json` is **not just a frontend package**. It is the build input
for three separate production artifacts:

| Artifact | Built by | Reads root `package.json` how |
|---|---|---|
| Railway `api` service | root `Dockerfile` | `npm ci` — installs everything |
| Railway `worker` service | root `Dockerfile` | `npm ci` — same image, `SERVICE_ROLE=worker` |
| Railway `echobrief` web | `Dockerfile.web` | `npm ci` then `vite build` |

All three are live in production today. Any change to the root package's install
graph is a change to three deployed services. That is the dominant risk, and it
rules out the option that would otherwise be most idiomatic.

### 2.2 Options considered

**Option A — convert the root to npm workspaces.**

```jsonc
// root package.json
{ "workspaces": ["mobile", "packages/shared"] }
```

Tempting, and Expo's monorepo support is genuinely good now — since SDK 52,
`expo/metro-config` auto-configures `watchFolders` and `nodeModulesPaths`, and the
docs explicitly tell you to *delete* the manual config that used to be required
([Expo monorepo guide](https://docs.expo.dev/guides/monorepos/)). From SDK 55,
autolinking deduplication is automatic for monorepo apps.

It still fails here, for a reason that has nothing to do with Metro:

1. **`npm ci` in a workspace root installs every workspace.** The Railway
   `Dockerfile` would start pulling `react-native`, `expo`, and ~40 native
   packages into the API image. Larger image, slower deploys, and a new class of
   build failure (an Expo package's postinstall breaking the API deploy). npm has
   no clean "install the root only" flag that is stable across versions —
   `--workspaces=false` is not reliably honoured by `ci`. **UNVERIFIED** whether
   npm 11 has fixed this; regardless, betting three production services on that
   flag's semantics is a bad trade for zero upside.
2. **Duplicate React is a live hazard.** Root pins `react: ^19.2.0`. Expo SDK 57
   pins its own React. If those resolve to different versions, npm nests one copy
   under `mobile/node_modules` and Metro happily bundles both → *"Invalid hook
   call"* at runtime, in a form that is notoriously hard to diagnose. Expo's docs
   state flatly that duplicate React Native versions in one monorepo "are not
   supported."
3. **Blast radius.** A hoisting change can alter which `zod` or `@tanstack/react-query`
   the *web* app resolves. The web app is in production.

**Option B — a fully separate repository.** Zero risk to the backend. But shared
code then requires a publish step (npm registry or git dependency), which means
every schema change becomes a two-repo, two-PR, version-bump dance. For a
solo-maintained project this is the highest-friction option and it will rot: the
schemas will drift, and drifted Zod contracts between client and server are
exactly the bug class this codebase currently does not have.

**Option C (recommended) — sibling folder, independent install, shared *source*
via bundler aliases.**

Add `mobile/` and `packages/shared/` to the existing repo. `mobile/` has its **own
`package.json` and its own `package-lock.json`** and is **not** an npm workspace.
Shared code is consumed as **TypeScript source** through a Metro `watchFolder` +
resolver alias on the mobile side, and a `tsconfig` path alias on the web side.
The package manager is never involved in the sharing.

### 2.3 Why Option C is right

It inverts the usual trade. Normally you accept package-manager complexity to get
correct dependency resolution. Here, the shared package has **no dependencies of
its own that need resolving** — it imports `zod` and (for the hooks) `@tanstack/react-query`,
and because it is consumed as *source* compiled into each app's bundle, those
imports resolve against **the consuming app's** `node_modules`. Two consequences,
both good:

- **Zero hoisting risk, zero duplicate React**, because there is no shared install
  graph at all. `npm ci` at the root behaves exactly as it does today. All three
  Railway services are untouched.
- **The Zod version skew problem solves itself.** Root is on Zod 3.24; latest Zod
  is 4.4.3. Mobile installs `zod@^3.24.2` to match, and the shared schemas compile
  identically on both sides. If and when the web app moves to Zod 4, mobile moves
  in the same PR, and the shared file is the thing that forces them to stay in sync.

The cost is that Metro must transpile files from outside the project root. That is
a solved, supported configuration — `watchFolders` is precisely the supported
mechanism — and it costs about fifteen lines of config, shown below.

**Recommendation: Option C.** Revisit Option A only if a second mobile app or a
third consumer appears, at which point the migration is a contained refactor
rather than a bet on three live services.

### 2.4 Concrete layout

```
echobrief-ai/
├── package.json                  ← UNCHANGED. No "workspaces" key. Ever.
├── package-lock.json             ← UNCHANGED
├── Dockerfile / Dockerfile.web   ← UNCHANGED (but see .dockerignore below)
├── src/                          ← UNCHANGED (web + api + worker)
│   └── lib/
│       ├── schemas.ts            ← becomes a 1-line re-export (§3.3)
│       └── api/hooks.ts          ← becomes a 1-line re-export (§3.3)
│
├── packages/
│   └── shared/                   ← NOT an npm package. Plain TS source.
│       ├── tsconfig.json         ← for editor + typecheck only, noEmit
│       └── src/
│           ├── index.ts
│           ├── schemas.ts        ← MOVED from src/lib/schemas.ts, verbatim
│           ├── api/
│           │   ├── client.ts     ← the factory (§3.4) — new
│           │   ├── hooks.ts      ← MOVED from src/lib/api/hooks.ts
│           │   └── query-keys.ts ← the `qk` object, extracted
│           └── errors.ts         ← ApiError + taxonomy (§11.1)
│
├── mobile/                       ← the Expo app; its own island
│   ├── package.json              ← own deps
│   ├── package-lock.json         ← own lockfile
│   ├── app.config.ts             ← APP_VARIANT-driven (§12)
│   ├── eas.json
│   ├── metro.config.js           ← the 15 lines below
│   ├── tsconfig.json
│   ├── app/                      ← expo-router routes
│   ├── src/
│   │   ├── features/
│   │   ├── services/
│   │   ├── lib/query/
│   │   └── config/
│   └── assets/
│
└── docs/mobile/TRD.md            ← this file
```

### 2.5 The actual config

**`mobile/metro.config.js`** — the only non-default Metro configuration needed.

```js
// mobile/metro.config.js
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, '..');
const sharedRoot = path.resolve(repoRoot, 'packages/shared');

const config = getDefaultConfig(projectRoot);

// Metro must watch and transpile source that lives outside the project root.
// This is the supported mechanism; it is NOT the pre-SDK-52 monorepo boilerplate
// (we are deliberately not setting nodeModulesPaths or disableHierarchicalLookup —
// there is no shared install graph to resolve).
config.watchFolders = [sharedRoot];

// Resolve the alias to source. No build step, no symlink, no package manager.
config.resolver.extraNodeModules = {
  '@echobrief/shared': path.resolve(sharedRoot, 'src'),
};

// Belt and braces: shared source must resolve React/zod/react-query from the
// MOBILE app's node_modules, never from the repo root's. Hierarchical lookup
// would walk up to repoRoot/node_modules and find the web app's copies.
config.resolver.disableHierarchicalLookup = true;
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];

module.exports = config;
```

> The last two lines are the important ones and they are easy to get wrong. Because
> `packages/shared/src` sits under `repoRoot`, Metro's default upward resolution
> would find `repoRoot/node_modules/react` — the web app's React 19.2 — while the
> app's own code resolves `mobile/node_modules/react`. That is the duplicate-React
> failure, arriving through the back door of Option C rather than Option A.
> `disableHierarchicalLookup` + an explicit `nodeModulesPaths` closes it. **This
> must be verified empirically on day one** with a `require.resolve` assertion in
> a smoke test (§14.2), not assumed.

**`mobile/tsconfig.json`**

```jsonc
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "paths": {
      "@echobrief/shared": ["../packages/shared/src/index.ts"],
      "@echobrief/shared/*": ["../packages/shared/src/*"],
      "@/*": ["./src/*"]
    }
  },
  "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "../packages/shared/src/**/*.ts"]
}
```

**Root `tsconfig.json`** — add the same alias so the web app resolves shared code:

```jsonc
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"],
      "@echobrief/shared": ["./packages/shared/src/index.ts"],
      "@echobrief/shared/*": ["./packages/shared/src/*"]
    }
  }
}
```

Vite picks this up through the already-installed `vite-tsconfig-paths` plugin — no
Vite config change required.

**`.dockerignore`** — add these two lines, or every Railway build starts shipping
the mobile app's source and assets into the API image:

```
mobile/
docs/
```

**Verification checklist before any of this is considered done:**

- [ ] `npm ci && npm run build && npm run build:api && npm test` at the repo root, unchanged results
- [ ] `docker build -f Dockerfile .` produces an image within 5% of its current size
- [ ] `cd mobile && npx expo start --clear` bundles without resolver errors
- [ ] The `require.resolve` duplicate-React smoke test passes on device

---

## 3. Shared code strategy

### 3.1 The audit's verdict, restated as a plan

The audit found three tiers of portability. The strategy follows them directly:

| File | Lines | Portability | Action |
|---|---|---|---|
| `src/lib/schemas.ts` | 421 | **100%** — pure Zod, zero browser refs | **Move verbatim** to shared |
| `src/lib/api/hooks.ts` | 689 | **~95%** — React Query, platform-agnostic | **Move**, inject the client |
| `src/lib/api/client.ts` | ~210 | **~40%** — `localStorage`, `window`, `import.meta.env` | **Rewrite the shell**; keep the logic |

Roughly 1,100 of 1,320 lines move without semantic change. That is the whole
argument for Option C in §2 — this much shared surface justifies the Metro config,
and would not justify a separate repo.

### 3.2 What moves, precisely

**Moves to `@echobrief/shared` (platform-free):**

- All Zod schemas and inferred types (`schemas.ts`) — **byte-identical**, no edits.
  This file is the contract with the server; any divergence is a bug.
- The `qk` query-key factory, extracted from `hooks.ts` into `query-keys.ts`.
  Extracted rather than left in place because the upload queue (§8) and the
  offline layer (§9) need to invalidate keys without importing every hook.
- `ApiError` and the error taxonomy (§11.1) — classification is pure logic.
- All TanStack Query hooks, **with one change**: they read the client from React
  context instead of importing a module singleton (§3.5).
- Retry/backoff policy, header construction, response parsing, the 403
  stale-workspace self-heal, the 429 classifier.

**Stays platform-specific (mobile side):**

| Concern | Why it cannot be shared |
|---|---|
| Token persistence | Keychain vs `localStorage` — different APIs, different sync semantics |
| `onUnauthorized` transport | `window.dispatchEvent` vs a store action / router navigation |
| Streaming reader | `expo/fetch` on native vs the global `fetch` on web |
| Base URL resolution | `EXPO_PUBLIC_*` (Metro-inlined) vs `import.meta.env` (Vite) |
| Upload execution | `NSURLSession` background task vs browser `fetch` PUT |
| Audio | Entirely native |
| Navigation, theming, all UI | Entirely platform |

**Stays web-specific (root repo):** everything under `src/components/`,
`src/routes/`, `src/server/`. None of it is a candidate.

### 3.3 The migration, without breaking the web app

The move happens in one PR and is designed to be behaviourally inert:

```ts
// src/lib/schemas.ts — after the move. The entire file.
export * from "@echobrief/shared/schemas";
```

```ts
// src/lib/api/hooks.ts — after the move. The entire file.
export * from "@echobrief/shared/api/hooks";
```

Every existing `import { MeetingStatus } from "@/lib/schemas"` in `src/` and in
`src/server/` keeps working with zero edits. The re-export shims stay permanently —
they cost nothing and they mean the ~40 server-side imports of `schemas.ts` never
need touching. `npm run typecheck` and `npm run build:api` are the acceptance gate.

### 3.4 `apiRequest` becomes a factory

This is the core of the shared strategy. Today's `client.ts` reaches for four
ambient globals — `window`, `localStorage`, `import.meta.env`, `CustomEvent` — and
each one is a separate reason it cannot run on a phone. The factory replaces all
four with injected capabilities. Nothing else about its behaviour changes.

```ts
// packages/shared/src/api/client.ts

/**
 * Token + workspace persistence, abstracted over the platform.
 *
 * The `get*` methods are DELIBERATELY SYNCHRONOUS. Every outbound request needs
 * the token to build its Authorization header, and making that async would turn
 * every call site into a race and every retry into a re-await. On web this is
 * localStorage (already sync). On iOS this is an in-memory cache hydrated from
 * the Keychain at boot, behind the splash screen — see §5.3. The Keychain write
 * on `setToken` is fire-and-forget async; the in-memory value updates first, so
 * a request issued in the same tick already sees the new token.
 */
export interface TokenStore {
  getToken(): string | null;
  setToken(token: string | null): void;
  getWorkspaceId(): string | null;
  setWorkspaceId(id: string | null): void;
}

export interface ApiClientConfig {
  /** Origin with or without the /api/v1 suffix. Normalized internally. */
  baseUrl: string;
  tokenStore: TokenStore;
  /**
   * Called after the client has already cleared the token, on a non-/auth 401.
   * Replaces `window.dispatchEvent(new CustomEvent("echobrief:unauthorized"))`.
   * Must not throw and must not block.
   */
  onUnauthorized: () => void;
  /**
   * Called after the client has cleared a stale workspace id and BEFORE it
   * retries. Replaces the "echobrief:workspace-changed" CustomEvent.
   */
  onWorkspaceReset: () => void;
  /**
   * Injected so native can supply `expo/fetch` (which, unlike React Native's
   * built-in fetch, gives us a real ReadableStream body — see §6.4).
   * Web passes globalThis.fetch. Tests pass a stub.
   */
  fetchImpl: typeof globalThis.fetch;
  /** Per-request wall-clock budget in ms. Defaults per §6.5. */
  timeoutMs?: number;
  /** Correlation id generator; native uses expo-crypto's randomUUID. */
  generateRequestId?: () => string;
  /** Structured telemetry sink. Native routes this to Sentry breadcrumbs. */
  onEvent?: (event: ApiClientEvent) => void;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
  raw?: boolean;
  /** Overrides the default retry policy for this call. See §6.3. */
  retry?: RetryPolicy;
}

export interface ApiClient {
  request<T>(path: string, opts?: RequestOptions): Promise<T>;
  /** Chunked-transfer text reader. Native and web differ ONLY in fetchImpl. */
  stream(
    path: string,
    opts?: Omit<RequestOptions, "raw">,
  ): Promise<{ stream: AsyncGenerator<string>; response: Response }>;
  getBaseUrl(): string;
}

export function createApiClient(config: ApiClientConfig): ApiClient;
```

Web wiring becomes a five-line adapter that preserves today's exact behaviour:

```ts
// src/lib/api/client.ts (web) — the shell, after the rewrite
import { createApiClient, type TokenStore } from "@echobrief/shared/api/client";

const webTokenStore: TokenStore = {
  getToken: () => localStorage.getItem("echobrief-auth-token"),
  setToken: (t) =>
    t
      ? localStorage.setItem("echobrief-auth-token", t)
      : localStorage.removeItem("echobrief-auth-token"),
  getWorkspaceId: () => localStorage.getItem("echobrief-active-workspace"),
  setWorkspaceId: (id) =>
    id
      ? localStorage.setItem("echobrief-active-workspace", id)
      : localStorage.removeItem("echobrief-active-workspace"),
};

export const apiClient = createApiClient({
  baseUrl: import.meta.env.VITE_API_URL ?? "",
  tokenStore: webTokenStore,
  onUnauthorized: () => window.dispatchEvent(new CustomEvent("echobrief:unauthorized")),
  onWorkspaceReset: () =>
    window.dispatchEvent(new CustomEvent("echobrief:workspace-changed", { detail: null })),
  fetchImpl: globalThis.fetch.bind(globalThis),
});
```

Note the SSR guard disappears. Today's client returns `null` from `getAuthToken()`
during SSR because `window` is undefined; with the factory, the web adapter is only
constructed in the browser and TanStack Start's SSR path never touches it. If a
current SSR code path *does* call `apiRequest`, that is a latent bug the migration
will surface — **UNVERIFIED**; check during the migration PR.

Mobile wiring is in §5.4.

### 3.5 Hooks read the client from context

The 689 lines of `hooks.ts` currently import `apiRequest` as a module singleton.
That has to become injectable, or shared hooks would drag the web client into the
mobile bundle. The change is mechanical and touches one line per hook:

```ts
// packages/shared/src/api/context.tsx
const ApiClientContext = createContext<ApiClient | null>(null);

export function ApiClientProvider({ client, children }: { client: ApiClient; children: ReactNode }) {
  return <ApiClientContext.Provider value={client}>{children}</ApiClientContext.Provider>;
}

export function useApiClient(): ApiClient {
  const client = useContext(ApiClientContext);
  if (!client) throw new Error("useApiClient must be used inside <ApiClientProvider>");
  return client;
}
```

```ts
// packages/shared/src/api/hooks.ts — representative diff
export function useMeeting(id: string) {
  const api = useApiClient();                    // + this line
  return useQuery({
    queryKey: qk.meeting(id),
    queryFn: () => api.request<Meeting>(`/meetings/${id}`),  // ~ was apiRequest(...)
    enabled: Boolean(id),
  });
}
```

Roughly 30 hooks × 2 lines. Tedious, mechanical, fully covered by
`npm run typecheck`. Do it in the same PR as the move so the web app is never in
a half-migrated state.

### 3.6 The invariant, enforced

`packages/shared` must never import a platform module. This is enforced in CI, not
by review:

```jsonc
// packages/shared/.eslintrc.json
{
  "rules": {
    "no-restricted-imports": ["error", {
      "patterns": ["react-native", "react-native/*", "expo", "expo-*", "expo/*", "@react-native*"],
      "paths": [
        { "name": "react-dom", "message": "shared/ must stay platform-free" }
      ]
    }],
    "no-restricted-globals": ["error", "window", "document", "localStorage", "sessionStorage"]
  }
}
```

---

## 4. Dependency manifest

All versions resolved from `registry.npmjs.org` on **2026-08-12**. Expo SDK 57 is
the current release train.

### 4.1 Core runtime

| Package | Version | Purpose | Expo Go? | Justification |
|---|---|---|---|---|
| [`expo`](https://www.npmjs.com/package/expo) | `57.0.12` | SDK, `expo/fetch`, module system | — | Baseline. Also the source of `expo/fetch`, which is load-bearing for §6.4. |
| [`react-native`](https://www.npmjs.com/package/react-native) | `0.87.0` | Runtime | — | Pinned by SDK 57. New Architecture is default and non-optional at this version. |
| `react` | `19.1.x` (SDK-pinned) | — | — | **Use the exact version `npx expo install --check` resolves.** Do not write `^19.2.0` to match the root. See §2.5. |
| [`expo-router`](https://www.npmjs.com/package/expo-router) | `57.0.12` | File-based routing | ✅ | Mirrors the web app's file-based TanStack Router mental model. Gives deep links and universal links for free, which §17's web-handoff needs. |
| [`react-native-screens`](https://www.npmjs.com/package/react-native-screens) | `4.27.0` | Native screen primitives | ✅ | expo-router peer. Native UINavigationController-backed transitions. |
| [`react-native-safe-area-context`](https://www.npmjs.com/package/react-native-safe-area-context) | `5.8.1` | Insets | ✅ | expo-router peer. Dynamic Island / home indicator correctness. |
| [`react-native-gesture-handler`](https://www.npmjs.com/package/react-native-gesture-handler) | `3.1.0` | Native gestures | ✅ | Required for the transcript scrubber and swipe-to-complete on action items. |
| [`react-native-reanimated`](https://www.npmjs.com/package/react-native-reanimated) | `4.5.3` | UI-thread animation | ✅ | Non-negotiable for §16's 60fps transcript budget — JS-thread animation cannot hold frame rate while a stream is decoding. |

### 4.2 Data & state

| Package | Version | Purpose | Expo Go? | Justification |
|---|---|---|---|---|
| [`@tanstack/react-query`](https://www.npmjs.com/package/@tanstack/react-query) | `5.101.4` | Server state | ✅ | **Already the web app's choice.** Using it is what makes `hooks.ts` 95% portable. Root is on 5.83; mobile on 5.101 is fine — same major, and the two never share an install. |
| [`@tanstack/react-query-persist-client`](https://www.npmjs.com/package/@tanstack/react-query-persist-client) | `5.101.4` | Cache persistence | ✅ | §9. Offline meeting list/detail on cold start. |
| [`@tanstack/query-async-storage-persister`](https://www.npmjs.com/package/@tanstack/query-async-storage-persister) | `5.101.4` | Persister backend | ✅ | Pairs with AsyncStorage. |
| [`@react-native-async-storage/async-storage`](https://www.npmjs.com/package/@react-native-async-storage/async-storage) | `3.1.1` | KV storage | ✅ | Query cache + upload queue. Chosen over MMKV: see note below. |
| [`zustand`](https://www.npmjs.com/package/zustand) | `5.0.14` | Client state | ✅ | ~1.2 kB. Session machine, workspace selection, theme, upload queue UI. §10. |
| [`zod`](https://www.npmjs.com/package/zod) | `^3.24.2` | Validation | ✅ | **Pinned to 3.x to match the server.** Zod 4.4.3 exists; adopting it here would fork the shared schema file. Upgrade both sides together or neither. |

> **AsyncStorage over `react-native-mmkv` (4.3.2).** MMKV is meaningfully faster and
> offers synchronous reads, which is genuinely attractive for the token cache. It is
> rejected for 1.0 on two grounds: it cannot run in Expo Go (JSI native module), and
> the sync-read advantage is already neutralised by the in-memory cache in §5.3.
> Revisit if §16's cold-start budget is missed and profiling points at storage.

### 4.3 Native capability modules

| Package | Version | Purpose | Expo Go? | Justification |
|---|---|---|---|---|
| [`expo-secure-store`](https://www.npmjs.com/package/expo-secure-store) | `57.0.1` | Keychain | ✅ | The only acceptable place for a bearer token. §5, §13. |
| [`expo-audio`](https://www.npmjs.com/package/expo-audio) | `57.0.3` | Record + play | ⚠️ **dev build** for background recording | The current audio module; `expo-av` is its predecessor ([docs](https://docs.expo.dev/versions/latest/sdk/audio/)). §7. |
| [`expo-file-system`](https://www.npmjs.com/package/expo-file-system) | `57.0.2` | Files + **background upload** | ⚠️ **dev build** for `sessionType: 'background'` | Provides `File.createUploadTask` with `BINARY_CONTENT` and background `NSURLSession`. This single API is what makes §8 tractable. |
| [`expo-document-picker`](https://www.npmjs.com/package/expo-document-picker) | `57.0.1` | Files.app import | ✅ | Half of the "share-sheet/Files import" scope item. |
| [`expo-share-intent`](https://www.npmjs.com/package/expo-share-intent) | `8.0.1` | iOS Share Extension | ❌ **dev build required** | The other half. Third-party (not first-party Expo) — adds a native Share Extension target via config plugin. Flagged as the highest third-party risk in §18. |
| [`expo-crypto`](https://www.npmjs.com/package/expo-crypto) | `57.0.1` | `randomUUID` | ✅ | Request-id correlation (§6.6) and local upload-queue ids. Avoids pulling `uuid` + a `get-random-values` polyfill. |
| [`expo-constants`](https://www.npmjs.com/package/expo-constants) | `57.0.10` | Build metadata | ✅ | Powers the §12.4 debug screen. |
| [`expo-linking`](https://www.npmjs.com/package/expo-linking) | `57.0.5` | Deep/universal links | ✅ | "Open in web app" handoff (§17, item 2). |
| [`expo-haptics`](https://www.npmjs.com/package/expo-haptics) | `57.0.1` | Haptics | ✅ | Record start/stop and action-item toggle confirmation. Small, but these are the two moments the user needs non-visual feedback. |
| [`expo-dev-client`](https://www.npmjs.com/package/expo-dev-client) | `57.0.11` | Custom dev runtime | — | Required the moment any ❌/⚠️ above is exercised. Assume it is needed from week one. |
| [`expo-build-properties`](https://www.npmjs.com/package/expo-build-properties) | `57.0.10` | Native build config | — | Sets `deploymentTarget: "17.0"` without ejecting. |

### 4.4 Observability

| Package | Version | Purpose | Expo Go? | Justification |
|---|---|---|---|---|
| [`@sentry/react-native`](https://www.npmjs.com/package/@sentry/react-native) | `8.22.0` | Crashes, errors, perf | ❌ dev build | The backend already runs `@sentry/node` 10.53. One vendor, correlated traces across API and app. §11.2. |

> Version note: `@sentry/react-native` is on major 8 while `@sentry/node` is on
> major 10. Different release trains for the same product — expected, not a
> mismatch. Trace correlation is by `sentry-trace` header, which is stable across
> both. **UNVERIFIED**: whether distributed tracing propagates cleanly from
> `expo/fetch` into the Hono API; test explicitly, and fall back to a shared
> `X-Request-Id` tag (§6.6) if not.

### 4.5 Dev & test

| Package | Version | Purpose |
|---|---|---|
| [`jest-expo`](https://www.npmjs.com/package/jest-expo) | `57.0.4` | Jest preset matching SDK 57 |
| [`@testing-library/react-native`](https://www.npmjs.com/package/@testing-library/react-native) | `14.0.1` | Component tests |
| [`eas-cli`](https://www.npmjs.com/package/eas-cli) | `21.8.0` | Builds + submissions |
| `typescript` | `5.8.3` | Matches root exactly |
| [`maestro`](https://maestro.mobile.dev) | latest binary | E2E flows. Not npm-installed — the `maestro-cli` npm package (1.1.10) is an unofficial wrapper; use the official install script. |

### 4.6 Deliberately excluded

Naming these matters as much as the inclusions, because each is a plausible
addition someone will propose in review.

| Package | Why not |
|---|---|
| `react-native-fetch-api` (3.0.0) + `web-streams-polyfill` (4.3.0) | The pre-SDK-52 way to get streaming. `expo/fetch` makes it obsolete (§6.4). Two dependencies and a global-patching side effect, for zero gain. |
| `expo-av` (16.0.8) | Superseded by `expo-audio`. Still published; do not use in new code. |
| `react-native-background-upload` (6.6.0) | `expo-file-system`'s `sessionType: 'background'` covers it, first-party, no config plugin. |
| `react-native-track-player` (4.1.2) | Built for music apps — queues, lock-screen controls, playlists. 1.0 needs single-file playback with seek; `expo-audio` does that. Revisit only if lock-screen controls become a requirement. |
| `nativewind` (4.2.6) | Tempting for Tailwind-token parity with web. But the web tokens are OKLCH in `styles.css`, and NativeWind's OKLCH support on RN is **UNVERIFIED**. 1.0 uses a hand-written token object mirroring `styles.css`. Reconsider for 1.1. |
| `@shopify/flash-list` (2.3.2) | FlatList meets §16's budgets for a paginated 20-item list. Add only if profiling says otherwise. |
| `jwt-decode` (4.0.0) | ~15 lines of local code replaces it (§5.5); Hermes has `atob`. Avoids a dependency on the auth hot path. |
| `detox` (20.51.4) | Heavier than Maestro to run, and CI cannot run either without a macOS runner (§14.4). Maestro's flow files are cheaper to maintain. |

---

## 5. Auth & session

### 5.1 The constraint

> HS256 JWT · `sub` = user id · **7-day TTL** · **no refresh endpoint** · zero cookies.

Everything in this section is downstream of that. There is no silent refresh, so
the app's job reduces to: hold the token securely, know exactly when it dies, and
make the death as non-disruptive as possible.

### 5.2 Storage

| Decision | Value | Reasoning |
|---|---|---|
| Backend | iOS Keychain via `expo-secure-store` 57.0.1 | Hardware-backed, survives reinstall-adjacent flows, excluded from unencrypted backups |
| Accessibility | `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` | **Deliberate, and not the default.** `WHEN_UNLOCKED` (the default) would make the token unreadable to a background upload finishing while the phone is locked in a pocket — the single most likely real-world upload scenario (§8). `THIS_DEVICE_ONLY` blocks iCloud Keychain sync, so a restored backup on a new phone requires a fresh login. That is correct for a bearer token. |
| `requireAuthentication` | `false` for 1.0 | Face ID on every token read would prompt during background upload completion, where no UI exists to host the prompt. Revisit as an opt-in "lock EchoBrief" setting in 1.1. |
| Key | `echobrief.auth.jwt` | — |
| Size | JWT ~200–400 bytes | Well under the ~2048-byte range where iOS historically rejects Keychain values ([docs](https://docs.expo.dev/versions/latest/sdk/securestore/)) |

Workspace id is **not** a secret and goes in AsyncStorage under
`echobrief.active-workspace`.

### 5.3 Solving the synchronous-read problem

`TokenStore.getToken()` must be synchronous (§3.4) but the Keychain is async.
Three candidate solutions:

1. Make the whole client async — rejected; poisons every call site and every retry.
2. `SecureStore.getItem()` — the sync variant exists, but the docs warn it "blocks
   the JavaScript thread." A blocking Keychain call on every request, including
   inside a streaming loop, is not acceptable.
3. **In-memory cache, hydrated once at boot, behind the splash screen.** Chosen.

```ts
// mobile/src/services/token-store.ts
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { TokenStore } from '@echobrief/shared/api/client';

const JWT_KEY = 'echobrief.auth.jwt';
const WORKSPACE_KEY = 'echobrief.active-workspace';
const KEYCHAIN_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

// The cache IS the source of truth at runtime. Keychain is durable backing.
let cachedToken: string | null = null;
let cachedWorkspaceId: string | null = null;
let hydrated = false;

/**
 * Called exactly once from the root layout, with the splash screen still up.
 * Nothing may issue an API request before this resolves — enforced by the
 * `booting` state in the machine below, not by ordering luck.
 */
export async function hydrateTokenStore(): Promise<void> {
  const [token, workspaceId] = await Promise.all([
    SecureStore.getItemAsync(JWT_KEY, KEYCHAIN_OPTS).catch(() => null),
    AsyncStorage.getItem(WORKSPACE_KEY).catch(() => null),
  ]);
  cachedToken = token;
  cachedWorkspaceId = workspaceId;
  hydrated = true;
}

export const tokenStore: TokenStore = {
  getToken() {
    if (__DEV__ && !hydrated) {
      throw new Error('tokenStore read before hydrateTokenStore() — see TRD §5.3');
    }
    return cachedToken;
  },
  setToken(token) {
    cachedToken = token;                       // synchronous: same-tick reads are correct
    void (token                                // durable write: fire-and-forget
      ? SecureStore.setItemAsync(JWT_KEY, token, KEYCHAIN_OPTS)
      : SecureStore.deleteItemAsync(JWT_KEY, KEYCHAIN_OPTS)
    ).catch((e) => reportNonFatal('keychain_write_failed', e));
  },
  getWorkspaceId: () => cachedWorkspaceId,
  setWorkspaceId(id) {
    cachedWorkspaceId = id;
    void (id ? AsyncStorage.setItem(WORKSPACE_KEY, id) : AsyncStorage.removeItem(WORKSPACE_KEY));
  },
};
```

Two details that are easy to miss and expensive to debug:

- The `__DEV__` guard turns "hydration race" from a silent 401 storm into a loud
  crash in development. Without it, the failure mode is: app boots, every query
  401s because the token was still `null`, `onUnauthorized` fires, the user is
  bounced to login despite having a perfectly valid session. That bug will
  otherwise be found by a user, not by us.
- `setToken` updates memory *before* awaiting the Keychain. A request issued in the
  same tick as login therefore already carries the new token. Reversing that order
  produces an intermittent "first request after login is unauthenticated" bug.

**Failure mode — Keychain write fails.** The user stays logged in for the session
(memory holds the token) but is logged out on next cold start. Report as non-fatal
to Sentry; do not block the UI.

### 5.4 Mobile client wiring

```ts
// mobile/src/services/api.ts
import { fetch as expoFetch } from 'expo/fetch';   // ← §6.4: NOT the global
import { randomUUID } from 'expo-crypto';
import { createApiClient } from '@echobrief/shared/api/client';
import { tokenStore } from './token-store';
import { useSessionStore } from '@/stores/session';
import { useWorkspaceStore } from '@/stores/workspace';
import { config } from '@/config';

export const apiClient = createApiClient({
  baseUrl: config.apiUrl,
  tokenStore,
  // No window. No CustomEvent. A direct store transition.
  onUnauthorized: () => useSessionStore.getState().expire(),
  onWorkspaceReset: () => useWorkspaceStore.getState().reset(),
  fetchImpl: expoFetch as unknown as typeof globalThis.fetch,
  generateRequestId: randomUUID,
  onEvent: (e) => Sentry.addBreadcrumb({ category: 'api', level: 'info', data: e }),
});
```

### 5.5 Expiry detection

No refresh endpoint means the client must reason about `exp` itself. Fifteen lines,
no dependency:

```ts
// packages/shared/src/api/jwt.ts
export interface JwtClaims { sub: string; exp: number; iat?: number }

/**
 * Decodes WITHOUT verifying. Verification is the server's job and cannot be done
 * on the client anyway (the HS256 secret must never reach the bundle — §13).
 * This exists only to schedule UI, never to make an authorization decision.
 */
export function decodeJwt(token: string): JwtClaims | null {
  try {
    const [, payload] = token.split('.');
    if (!payload) return null;
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(
      payload.length + ((4 - (payload.length % 4)) % 4), '=',
    );
    const claims = JSON.parse(
      decodeURIComponent(
        atob(b64).split('').map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''),
      ),
    ) as JwtClaims;
    return typeof claims.exp === 'number' ? claims : null;
  } catch {
    return null;
  }
}

export const MS = { minute: 60_000, hour: 3_600_000, day: 86_400_000 } as const;
export const expiresAt = (t: string) => (decodeJwt(t)?.exp ?? 0) * 1000;
export const isExpired = (t: string, skewMs = 30_000) => expiresAt(t) - skewMs <= Date.now();
/** 24h before death: the app starts asking rather than waiting to be told. */
export const isExpiringSoon = (t: string) => expiresAt(t) - Date.now() < MS.day;
```

`atob` is available in Hermes on RN 0.87. **UNVERIFIED** on the exact Hermes build
shipped with SDK 57 — assert it in the smoke test (§14.2); the fallback is
`expo-crypto`'s base64 helpers.

### 5.6 Session state machine

```
                    ┌──────────┐
      app launch───►│ booting  │  splash held; hydrateTokenStore() in flight
                    └────┬─────┘
                         │ hydrated
              ┌──────────┴──────────┐
     no token │                     │ token present
              ▼                     ▼
      ┌───────────────┐      ┌──────────────┐
      │ unauthenticated│      │  validating  │  decode exp locally (no network)
      └───────┬───────┘      └──────┬───────┘
              │                     │
              │            ┌────────┼─────────────────┐
              │    expired │        │ valid           │ valid & exp-now < 24h
              │            ▼        ▼                 ▼
              │      (clear)  ┌───────────┐   ┌──────────────┐
              │            │  │ authenticated │ │ expiringSoon │
              │            │  └─────┬─────┘   └──────┬───────┘
              │            │        │                │ banner: "Session ends in
              │            │        │ 401 from any   │ N days — sign in again"
              │            │        │ non-/auth call │ (dismissible, reappears
              │            │        ▼                │  daily; blocks nothing)
              │            │  ┌──────────┐           │
              │            │  │ expired  │◄──────────┘ on exp reached
              │            │  └────┬─────┘
              │            │       │ token cleared; cache PRESERVED (§9);
              │            │       │ upload queue PRESERVED (§8.6)
              │◄───────────┴───────┘
              │
              │ login/signup success
              ▼
      ┌──────────────┐
      │ authenticating│ ──error──► unauthenticated (+ typed error, §11.1)
      └──────┬───────┘
             ▼
      authenticated
```

**Transitions in detail:**

| From | Trigger | To | Side effects |
|---|---|---|---|
| `booting` | hydration done, no token | `unauthenticated` | Hide splash → `/(auth)/login` |
| `booting` | hydration done, token valid | `authenticated` | Hide splash → `/(tabs)/meetings`. Render from persisted cache immediately. |
| `booting` | hydration done, token expired | `unauthenticated` | Clear Keychain. **Keep** query cache and upload queue. |
| `authenticated` | 401 on a non-`/auth/*` route | `expired` | Client already cleared the token. Clear workspace. Cancel in-flight streams. Show "Session expired" screen with the email pre-filled. |
| `authenticated` | `exp - now < 24h` | `expiringSoon` | Non-blocking banner. Checked at boot and on every foreground. |
| `expired` | successful re-login | `authenticated` | **If `sub` matches the previous user, keep the cache and resume uploads.** If not, wipe everything (§5.7). |
| any | explicit logout | `unauthenticated` | Full teardown, §5.8 |

**Pre-emptive re-auth, honestly.** Without a refresh endpoint, "pre-emptive" means
"ask the user early, in a good moment, instead of late, in a bad one." The banner
at T−24h converts a hard interruption (mid-recording logout) into a soft one. It
is a mitigation. §17 item 4 is the actual fix, and it is cheap.

### 5.7 401 handling without `window`

The shared client already clears the token, then calls the injected
`onUnauthorized`. On mobile that is `useSessionStore.getState().expire()`:

```ts
// mobile/src/stores/session.ts (excerpt)
expire: () => {
  const { status } = get();
  if (status === 'expired' || status === 'unauthenticated') return;  // idempotent
  set({ status: 'expired' });
  queryClient.cancelQueries();      // kill in-flight streams; do NOT clear the cache
  useWorkspaceStore.getState().reset();
  // Navigation is a REACTION to state, in a root-layout effect — never called
  // from inside the API client. Keeps the client testable in plain Node.
},
```

The idempotence guard matters: a screen with six parallel queries produces six
401s, and without it the user gets six navigations and a flickering stack.

### 5.8 Logout

Ordered, and the order is deliberate:

1. `POST` nothing — the API is stateless; there is no server-side session to end.
2. `tokenStore.setToken(null)` → memory cleared synchronously, Keychain delete queued.
3. `tokenStore.setWorkspaceId(null)`.
4. `queryClient.clear()` **and** `persister.removeClient()` — otherwise the next
   user on this device sees the previous user's meeting titles on the offline
   screen. This is a real privacy defect, not a tidiness issue.
5. Delete queued upload files and clear the upload queue, **after** an explicit
   confirmation if the queue is non-empty: *"You have 2 recordings that haven't
   uploaded. Signing out will delete them."*
6. Stop and dispose any active recorder; deactivate the audio session.
7. `router.replace('/(auth)/login')`.

> **▸ SwiftUI divergence.** Steps 2–4 would be `KeychainAccess` + a SwiftData
> container delete. The 401 event bus would be a Combine publisher or an
> `@Observable` model rather than a Zustand store, and the sync-read problem in
> §5.3 largely disappears because Keychain reads from Swift are synchronous by
> nature and cheap enough on the main actor for a single token.

---

## 6. Networking layer

### 6.1 Shape

One `ApiClient` instance, created at app start, provided through React context,
consumed by the shared hooks. No component ever calls `fetch`. No module-level
singleton (that is what made the web client untestable and unportable).

### 6.2 Request pipeline

```
request(path, opts)
  1. Build URL: normalizeBaseUrl(baseUrl) + path + serialized query
  2. Headers:
       content-type: application/json                  (when a body exists)
       authorization: Bearer <tokenStore.getToken()>   (when non-null — sync)
       x-workspace-id: <tokenStore.getWorkspaceId()>   (when non-null)
       x-request-id: <generateRequestId()>             (§6.6)
       accept: application/json                        (or text/plain when streaming)
  3. AbortSignal: caller's signal ∪ timeout signal (§6.5)
  4. fetchImpl(...)  ← expo/fetch on native
  5. !response.ok:
       a. parse the error envelope (off a clone if raw)
       b. 403 + /not a member of this workspace/i + !isRetry
            → setWorkspaceId(null); onWorkspaceReset(); retry once
       c. 401 && !path.startsWith('/auth/')
            → setToken(null); setWorkspaceId(null); onUnauthorized()
       d. 429 → classify (§6.4) and attach retry metadata
       e. raw callers get the untouched Response; others get a thrown ApiError
  6. ok: 204 → undefined; raw → Response; else → response.json()
```

Steps 5b and 5c are lifted from the existing web client unchanged. They are correct
and battle-tested; the only edit is that the two `window.dispatchEvent` calls
became injected callbacks.

### 6.3 Retry and backoff

Retry policy is split between the client (transport-level) and TanStack Query
(query-level), and they must not both retry the same failure — that is how a
5-second outage becomes a 40-second one.

| Failure | Client retries? | Query retries? | Policy |
|---|---|---|---|
| Network unreachable | No | **Yes** | Query's exponential backoff, capped at 3 |
| Timeout (§6.5) | No | **Yes** | Same |
| 5xx | No | **Yes** | Same |
| 429 rate-limit | No | **Yes**, honouring `Retry-After` | Never faster than the header says |
| 429 quota | **No** | **No** | Terminal. Not a transient failure — retrying is user-hostile and burns nothing but battery. |
| 401 | No | **No** | Terminal → session machine |
| 403 stale workspace | **Yes, exactly once** | No | The self-heal. Client-level because it mutates client state before retrying. |
| 4xx (other) | No | No | Terminal |

```ts
// Query-client defaults
const RETRYABLE_STATUS = new Set([408, 425, 500, 502, 503, 504]);

retry: (failureCount, error) => {
  if (failureCount >= 3) return false;
  if (!(error instanceof ApiError)) return true;                 // network/timeout
  if (error.status === 429) return error.code !== 'quota_exceeded';
  return RETRYABLE_STATUS.has(error.status);
},
retryDelay: (attempt, error) => {
  const after = error instanceof ApiError ? error.retryAfterMs : undefined;
  if (after != null) return after;                               // server's number wins
  const base = Math.min(1000 * 2 ** attempt, 30_000);
  return base + Math.random() * 0.3 * base;                      // 30% jitter
},
```

Jitter is not decorative. A user backgrounding and foregrounding the app after a
network drop triggers every query to refetch simultaneously; without jitter they
retry in lockstep and hammer the rate limiter into 429ing all of them.

**Mutations never retry automatically.** `POST /meetings` is not idempotent, and a
blind retry creates duplicate meeting rows. Failed mutations surface a manual
"Try again" affordance.

### 6.4 429 handling — two different things wearing the same status code

```ts
// packages/shared/src/errors.ts
export function classify429(status: number, payload: unknown, headers: Headers) {
  if (status !== 429) return null;
  const p = payload as { error?: string; tier?: string; current?: number; limit?: number };
  if (p?.error === 'quota_exceeded') {
    return {
      kind: 'quota' as const,
      tier: p.tier, current: p.current, limit: p.limit,
      retryAfterMs: undefined,          // terminal — do NOT retry
    };
  }
  const ra = headers.get('retry-after');
  return {
    kind: 'rate_limit' as const,
    retryAfterMs: ra ? Number(ra) * 1000 : 60_000,
    limit: Number(headers.get('x-ratelimit-limit')) || undefined,
    remaining: Number(headers.get('x-ratelimit-remaining')) || undefined,
  };
}
```

Two entirely different user experiences:

- **Quota** → a sheet: *"You've used all 10 meetings on the Free plan this month.
  Upgrade in the web app to keep going."* with a deep link. Never a retry button.
- **Rate limit** → an inline countdown: *"Too many attempts. Try again in 4:32."*
  The submit button disables and counts down rather than letting the user
  re-trigger it and reset their own window.

**Login rate limits are a mobile-specific hazard.** 5 attempts / 15 min and
3 signups / hour are IP-keyed. Behind carrier-grade NAT, many users share one
apparent IP, so a legitimate user can be locked out by strangers. §17 item 8.

### 6.5 Timeout budgets

React Native has no default fetch timeout — a request against a black-holed network
hangs until the OS gives up, which can exceed a minute. Every request gets an
explicit budget.

| Class | Budget | Reasoning |
|---|---|---|
| `GET` list/detail | 15 s | p99 well under; beyond this the cache is a better answer |
| Auth (`/auth/*`) | 20 s | argon2 verification is intentionally slow |
| Mutations | 20 s | — |
| `POST /meetings/upload-url` | 20 s | Includes a DB insert |
| **R2 binary PUT** | **none (idle-timeout only)** | A 500 MB upload on a bad connection legitimately takes many minutes. Bounded by NSURLSession's idle timeout, not wall clock. |
| **Streaming (chat/search/email)** | **no wall clock; 30 s idle** | GPT-5 time-to-first-token can be seconds; total can be a minute. Aborting on total elapsed time would kill healthy responses. Reset an idle timer on every chunk instead. |

```ts
function withTimeout(signal: AbortSignal | undefined, ms: number | null) {
  if (ms == null) return signal;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new DOMException('Timeout', 'TimeoutError')), ms);
  signal?.addEventListener('abort', () => ctrl.abort(signal.reason), { once: true });
  // Caller clears via the returned cleanup; omitted here for brevity.
  return ctrl.signal;
}
```

### 6.6 Request correlation

Every request carries `x-request-id: <uuid v4>` from `expo-crypto`. It is attached
to the Sentry breadcrumb, included in user-facing error detail text (small, monospace,
long-press to copy), and — pending §17 item 9 — echoed by the API into its own logs.
Without this, "the app said something went wrong" is unactionable against a
Railway log stream.

### 6.7 The streaming solution

This is the highest-risk item in the networking layer, because React Native's
built-in `fetch` **does not populate `response.body`**. The existing `apiStream`
guards with `if (!response.body) return;` — meaning on React Native a streaming
chat would produce **an empty, successful, silent response**. Not an error. Not a
crash. Just nothing. That is the worst possible failure mode and it would ship
undetected without a deliberate fix.

**Options evaluated:**

| Option | Streams? | Headers? | Cost | Verdict |
|---|---|---|---|---|
| RN built-in `fetch` | ❌ `body` undefined | ✅ | 0 | **Fails silently. Unusable.** |
| `react-native-fetch-api` 3.0.0 + `web-streams-polyfill` 4.3.0 | ✅ | ✅ | 2 deps, patches globals | Works. Was the standard answer pre-SDK-52. Now redundant. |
| `XMLHttpRequest` + `readyState === 3` | ✅ (via `responseText` slicing) | ✅ | 0 deps | Works, but accumulates the whole response in memory and requires manual delta slicing. Ugly. Good fallback. |
| **`expo/fetch`** | ✅ **real `ReadableStream`** | ✅ | 0 extra deps | **Chosen.** |

`expo/fetch` is a WinterCG-compliant Fetch implementation shipped inside the `expo`
package, explicitly documented as supporting streamed response bodies via
`response.body.getReader()`, and it works in Expo Go
([docs](https://docs.expo.dev/versions/latest/sdk/expo/)). Since it is already a
transitive part of the SDK, this costs nothing.

Two subtleties:

1. On native, `expo/fetch` **replaces the global `fetch` by default** in SDK 57.
   We still **import it explicitly** rather than relying on that, because the
   behaviour is toggleable via `EXPO_PUBLIC_USE_RN_FETCH=1` and a stray env var
   should not silently reintroduce the empty-stream bug.
2. The docs note `TextDecoder` on native is UTF-8 only and not fully spec-compliant.
   The API emits UTF-8, so this is fine — but multi-byte characters *will* split
   across chunk boundaries, which is why `{ stream: true }` below is mandatory, not
   optional. Dropping it produces intermittent mojibake on emoji and accented
   characters, roughly one chunk in a few hundred.

```ts
// packages/shared/src/api/client.ts — stream(), platform-independent
async stream(path, opts = {}) {
  const response = await this.request<Response>(path, { ...opts, raw: true });

  if (!response.ok) {
    let payload: { error?: string; message?: string } = {};
    try { payload = await response.json(); } catch { /* not JSON */ }
    throw new ApiError(response.status, payload.error ?? 'http_error',
                       payload.message ?? response.statusText);
  }

  // Hard failure instead of the silent empty-yield the web client does today.
  // If this throws, fetchImpl is wrong — almost certainly RN's global fetch
  // instead of expo/fetch. Loud is correct: see §6.7.
  if (!response.body) {
    throw new ApiError(0, 'stream_unsupported',
      'This build cannot read streamed responses (fetchImpl lacks ReadableStream).');
  }

  const stream = (async function* () {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();          // UTF-8, the only encoding on native
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });   // ← multi-byte safety
        if (text) yield text;
      }
      const tail = decoder.decode();            // flush any trailing partial sequence
      if (tail) yield tail;
    } finally {
      reader.releaseLock();
    }
  })();

  return { stream, response };
}
```

Consumption, with the render throttle that §16 requires:

```ts
// mobile/src/features/chat/use-chat-stream.ts
export function useChatStream(meetingId: string) {
  const api = useApiClient();
  const [text, setText] = useState('');
  const [state, setState] = useState<'idle' | 'streaming' | 'done' | 'error'>('idle');
  const bufferRef = useRef('');
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(async (message: string) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    bufferRef.current = '';
    setText('');
    setState('streaming');

    // Flush on a 60ms cadence (~16fps of text updates) rather than per chunk.
    // GPT-5 emits tokens far faster than 16Hz; a setState per chunk means
    // hundreds of re-renders of a growing text node and a dropped-frame scroll.
    let raf: ReturnType<typeof setInterval> | null = setInterval(() => {
      setText(bufferRef.current);
    }, 60);

    try {
      const { stream } = await api.stream(`/meetings/${meetingId}/chat`, {
        method: 'POST', body: { message }, signal: ctrl.signal,
      });
      for await (const chunk of stream) bufferRef.current += chunk;
      setState('done');
    } catch (e) {
      setState(ctrl.signal.aborted ? 'idle' : 'error');
      if (!ctrl.signal.aborted) reportError(e);
    } finally {
      if (raf) { clearInterval(raf); raf = null; }
      setText(bufferRef.current);              // final flush — never lose the tail
    }
  }, [api, meetingId]);

  useEffect(() => () => abortRef.current?.abort(), []);   // abort on unmount
  return { text, state, send, cancel: () => abortRef.current?.abort() };
}
```

**`/search` citations.** Returned in the `x-citations` response header as
URI-encoded JSON, available on the `response` object before the stream drains — so
citation chips can render before the answer text arrives:

```ts
const { stream, response } = await api.stream('/search', { method: 'POST', body: { q } });
const citations = JSON.parse(decodeURIComponent(response.headers.get('x-citations') ?? '%5B%5D'));
```

**Verification, day one.** Before any chat UI is written, prove the transport:
point a dev build at the production API, stream one chat response, and assert more
than one distinct chunk arrives with measurable time between the first and last.
A single-chunk arrival means something (RN's fetch, or a proxy) is buffering the
whole response, and the streaming UX is a lie. **UNVERIFIED until that test runs.**

> **▸ SwiftUI divergence.** All of §6.7 evaporates. `URLSession.bytes(for:)` gives
> an `AsyncSequence<UInt8>` natively, with no polyfill, no `fetchImpl` injection,
> and no silent-empty-body failure class. This is the single strongest technical
> argument for native iOS in this project, and it is worth stating plainly: RN
> costs us a real risk here that Swift would not have.

---

## 7. Audio subsystem

### 7.1 Module choice

**`expo-audio` 57.0.3.** The Expo audio documentation for SDK 57 documents
`expo-audio` as the audio library and references `expo-av` only as its predecessor
([docs](https://docs.expo.dev/versions/latest/sdk/audio/)). `expo-av` 16.0.8 is
still published but must not be used in new code.

### 7.2 Format — the decision that avoids a backend change

The accepted MIME enum (`src/lib/schemas.ts:29-39`) is closed, and critically
**`audio/aac` and `audio/x-caf` are absent**. If the recorder produced raw ADTS AAC
or Core Audio Format, every upload would 400 and the backend would need changing
before the app could ship at all.

It does not. `expo-audio`'s `HIGH_QUALITY` preset produces an **MPEG-4 container**
(`IOSOutputFormat.MPEG4AAC`, extension `.m4a`), and `audio/mp4` **is** in the enum.
So recording works against the API exactly as it stands today.

| Setting | Value | Reasoning |
|---|---|---|
| Preset | `RecordingPresets.HIGH_QUALITY` | m4a / MPEG4AAC / 44.1 kHz / 128 kbps |
| Channels | **1 (mono)** — override the preset's 2 | Halves file size. Diarization gains nothing from a stereo mix off one iPhone mic array. A 2-hour meeting drops from ~115 MB to ~58 MB. |
| Bit rate | **64 kbps** — override 128 | Speech, not music. AssemblyAI's accuracy is flat above ~48 kbps for 16 kHz-band speech. Halves size again: ~29 MB for 2 hours. **UNVERIFIED** — validate WER against a 128 kbps reference on three real meetings before committing. If WER degrades, revert to 128; 58 MB is still fine. |
| Sample rate | 44.1 kHz | Leave alone. AssemblyAI downsamples server-side; resampling on-device costs battery for nothing. |
| Declared MIME | **`audio/mp4`** | In the enum. Do **not** send `audio/m4a` — it is in the enum but is not a registered IANA type, and `audio/mp4` is what R2 and the worker will handle most predictably. |

The size arithmetic matters beyond bandwidth: the 500 MB cap at 64 kbps mono is
~17 hours of audio, so the 4-hour duration cap always binds first. That means the
app can enforce duration client-side and never has to explain a size rejection.

### 7.3 Recording configuration

```ts
// mobile/app.config.ts (excerpt)
plugins: [
  ['expo-audio', {
    microphonePermission:
      'EchoBrief uses the microphone to record meetings you choose to capture.',
    enableBackgroundRecording: true,      // adds UIBackgroundModes: ["audio"]
  }],
],
ios: {
  infoPlist: {
    UIBackgroundModes: ['audio'],         // explicit; the plugin also sets it
  },
},
```

```ts
// mobile/src/services/recorder.ts
import {
  useAudioRecorder, useAudioRecorderState, setAudioModeAsync, RecordingPresets,
} from 'expo-audio';

const ECHOBRIEF_PRESET = {
  ...RecordingPresets.HIGH_QUALITY,
  numberOfChannels: 1,
  bitRate: 64_000,
} as const;

export async function prepareAudioSession() {
  await setAudioModeAsync({
    allowsRecording: true,
    allowsBackgroundRecording: true,   // requires UIBackgroundModes: audio
    playsInSilentMode: true,           // otherwise playback is silent with the ring switch off
    interruptionMode: 'doNotMix',      // we want the mic exclusively while recording
  });
}
```

**App Store note.** `UIBackgroundModes: ["audio"]` draws review scrutiny — Apple
rejects apps that declare it without a user-visible reason. Ours is legitimate
(the user explicitly starts a recording that must survive backgrounding), but the
review notes must say so, and the app must show a visible recording indicator. The
iOS red status-bar pill appears automatically; we additionally keep a persistent
in-app banner and a Live Activity is deliberately **out of scope** for 1.0.

### 7.4 Interruption handling

Interruptions are the defining reliability problem of a recording app. A phone call
during a 90-minute meeting must not cost the user 90 minutes.

| Event | Behaviour | Data outcome |
|---|---|---|
| Incoming phone call / FaceTime | iOS suspends the session. Auto-pause; on `.shouldResume`, auto-resume and post a local notification: *"Recording resumed after your call."* | Audio before and after preserved; the call duration is a gap |
| Siri | Same as a call | Preserved |
| Another app takes the mic | Pause. Do **not** auto-resume (the user chose the other app). Banner: *"Recording paused — tap to resume."* | Preserved |
| Route change (AirPods connect/disconnect) | Continue on the new route. Log the route change. | Preserved |
| App backgrounded | Continues — this is what `enableBackgroundRecording` buys | Preserved |
| **App killed by user** (swipe up) | Recording stops immediately; iOS gives no callback | **Partial file on disk is recoverable — see below** |
| **Low storage** | Poll free space every 30 s while recording; below 500 MB, stop cleanly and tell the user | Preserved up to the stop |
| Low battery / device shutdown | No callback available | Partial file recoverable |

**The recovery mechanism.** The recorder writes to
`Paths.document/recordings/<uuid>.m4a` and, on `record()`, writes a sidecar
`<uuid>.json` describing the in-progress session (started-at, intended title,
workspace id). On every cold start the app scans that directory for sidecars with
no matching completed-queue entry and offers: *"EchoBrief was interrupted while
recording on Tuesday at 2:14 PM. Recover this recording?"*

An `.m4a` truncated mid-write is often still playable because the MPEG-4 writer
flushes `mdat` progressively, but the `moov` atom may be missing or stale, in which
case duration metadata is wrong or the file is unreadable. **UNVERIFIED**: whether
`expo-audio`'s iOS writer produces a recoverable file after a hard kill. **Test
this explicitly** — record 60 s, force-quit, inspect the file. If it is not
recoverable, the mitigation is periodic `pause()`/`record()` segmentation (which
forces a `moov` flush) at 5-minute boundaries, with concatenation before upload.
That is a meaningfully larger amount of work, so resolve it early; it is on the
§18 risk list.

**Recording never blocks on the network.** The file lands on disk first, and the
upload queue (§8) takes it from there. A recording made in airplane mode is safe.

### 7.5 Playback and transcript sync

```ts
const player = useAudioPlayer({ uri: signedAudioUrl });
const status = useAudioPlayerStatus(player);   // currentTime, duration, playing
```

Transcript segments arrive with `start_ms`/`end_ms`. Mapping playback position to
the active segment on every status tick is the obvious implementation and the wrong
one — it is O(n) per tick over a transcript that can hold thousands of segments.

**Design:**

- Build a sorted `start_ms[]` array once per meeting, memoized. Locate the active
  segment by **binary search** — O(log n), ~11 comparisons for 2,000 segments.
- Poll position at **4 Hz**, not 60 Hz. Highlight granularity finer than 250 ms is
  imperceptible against speech, and 60 Hz polling wakes the JS thread pointlessly.
- Only the active segment index lives in React state. Segments read it through
  context and re-render individually; a position change re-renders exactly two rows
  (the one leaving and the one entering), not the list.
- **Tap-to-seek**: `player.seekTo(segment.start_ms / 1000)` plus a light haptic.
- **Auto-scroll** follows the active segment, but suspends for 5 seconds after any
  manual scroll — otherwise the list yanks itself out from under a user who is
  reading ahead. This is the single most-noticed detail in a transcript UI.

Playback audio mode differs from recording mode and must be set on entering the
detail screen:

```ts
await setAudioModeAsync({
  playsInSilentMode: true,        // users expect meeting audio with the ringer off
  shouldPlayInBackground: false,  // 1.0: no lock-screen controls, so no background audio
  interruptionMode: 'doNotMix',
});
```

`shouldPlayInBackground: false` is a scope decision: background playback without
lock-screen controls (`MPNowPlayingInfoCenter`) is a bad experience and an App
Review risk. Ship it in 1.1 together with proper Now Playing integration.

> **▸ SwiftUI divergence.** Interruption handling would use
> `AVAudioSession.interruptionNotification` directly, giving access to
> `AVAudioSession.InterruptionOptions.shouldResume`, which is more precise than
> what `expo-audio` surfaces. Transcript sync would use `AVPlayer`'s
> `addPeriodicTimeObserver` — no polling loop and no JS thread involvement at all.
> Segmented recovery (§7.4) would use `AVAssetWriter` with explicit segment
> boundaries, which is a first-class API rather than a workaround.

---

## 8. Upload subsystem

### 8.1 The contract, and the one rule that breaks everything

```
1. POST /api/v1/meetings/upload-url   { filename, content_type, size, duration_sec?, ... }
      → { meeting_id, upload_url, audio_key, expires_at }     presign TTL 3600 s
2. PUT <upload_url>                   raw bytes, no multipart, no chunked encoding
3. POST /api/v1/meetings              { meeting_id, ... }     → enqueues BullMQ
```

**`content-length` is signed into the presigned URL.** `src/server/services/r2.ts:69-79`
passes both `ContentType` and `ContentLength` to `PutObjectCommand` before signing.
Per the audit, `content-length` ends up in `SignedHeaders` while `content-type` does
not. The operational consequence:

> **The PUT must send a `Content-Length` byte-for-byte equal to the `size` sent in
> step 1. Off by one byte → SignatureDoesNotMatch → 403.**

This kills three things outright: multipart uploads, chunked transfer encoding, and
any transform between measuring the file and sending it (no gzip, no re-encode, no
"fix up the metadata first"). It also means the size must be **measured exactly
once** and that same integer threaded through both requests. Re-reading `file.size`
at PUT time is a bug waiting for a race with a still-flushing writer.

```ts
// The invariant, expressed in code. Measure once.
const file = new File(recordingUri);
const byteSize = file.size;                       // ← the ONLY read of size, ever
if (byteSize == null || byteSize === 0) throw new UploadError('empty_file');

const presign = await api.request<UploadUrlResponse>('/meetings/upload-url', {
  method: 'POST',
  body: { filename, content_type: 'audio/mp4', size: byteSize, duration_sec, title, tags },
});
// byteSize is now cryptographically committed. Do not touch the file again.
```

**UNVERIFIED and must be settled in week one:** whether `content-type` is truly
unsigned. The code passes it to the command; the audit says it does not land in
`SignedHeaders`. The two are consistent (the AWS S3 presigner hoists some headers
and treats others as unsignable), but the failure mode if the audit is wrong is
that *every upload 403s*. Test: presign a URL, PUT with a deliberately different
`Content-Type`, observe. If it is signed, the app must send the exact declared type
— easy, but it must be known.

### 8.2 Mechanism

`expo-file-system` 57.0.2 provides `File.createUploadTask` with
`uploadType: BINARY_CONTENT` and `sessionType: 'background'`, which maps to a
background `NSURLSession` — transfers continue after the app is suspended and even
after it is terminated by the system
([docs](https://docs.expo.dev/versions/latest/sdk/filesystem/)).

```ts
// mobile/src/services/uploader.ts
import { File, Paths } from 'expo-file-system';

export async function uploadToR2(
  localUri: string,
  presignedUrl: string,
  expectedBytes: number,                 // the SAME number sent to /upload-url
  onProgress: (sent: number, total: number) => void,
) {
  const file = new File(localUri);

  // Last line of defence against the signature mismatch in §8.1.
  if (file.size !== expectedBytes) {
    throw new UploadError('size_drift', `expected ${expectedBytes}, found ${file.size}`);
  }

  const task = file.createUploadTask(presignedUrl, {
    httpMethod: 'PUT',
    uploadType: 0,                       // BINARY_CONTENT — raw body, NOT multipart
    sessionType: 'background',           // survives suspension and termination
    headers: {
      // Content-Length is set by the native uploader from the file size.
      // Do NOT set Transfer-Encoding. Do NOT set Content-Type unless §8.1 resolves
      // to "content-type is signed", in which case set it to the declared value.
    },
    onProgress: ({ bytesSent, totalBytes }) => onProgress(bytesSent, totalBytes),
  });

  const result = await task.uploadAsync();
  if (!result || result.status < 200 || result.status >= 300) {
    throw new UploadError('r2_rejected', `R2 returned ${result?.status}`, result?.status);
  }
}
```

### 8.3 The durable queue

The queue is the app's second piece of irreplaceable state (after the recording
file itself) and it is designed to survive a cold start.

```ts
type UploadJobState =
  | 'pending'        // file on disk, nothing requested yet
  | 'presigning'     // POST /meetings/upload-url in flight
  | 'uploading'      // PUT to R2 in flight
  | 'registering'    // POST /meetings in flight
  | 'done'
  | 'failed'         // terminal until the user retries
  | 'expired';       // presign TTL elapsed mid-upload; needs a fresh presign

interface UploadJob {
  id: string;                    // expo-crypto randomUUID
  localUri: string;
  filename: string;
  contentType: 'audio/mp4';
  byteSize: number;              // measured ONCE (§8.1)
  durationSec: number;
  title: string;
  tags: string[];
  workspaceId: string | null;
  source: 'recording' | 'share' | 'files';
  state: UploadJobState;
  meetingId?: string;            // from step 1
  presignedUrl?: string;
  presignExpiresAt?: number;     // epoch ms
  bytesSent: number;
  attempts: number;
  lastError?: { code: string; message: string; at: number };
  createdAt: number;
}
```

Persisted to AsyncStorage under `echobrief.upload-queue` on **every state
transition** — not on an interval, not debounced. A crash between transitions must
never lose a job. The payload is small (a few hundred bytes per job) so the write
cost is irrelevant.

Audio files live in `Paths.document/recordings/`, **not** `Paths.cache` — iOS
purges the cache directory under storage pressure, which would silently delete a
user's unuploaded meeting. Files are deleted only after `POST /meetings` returns
2xx.

### 8.4 State machine

```
     pending
        │ (network available, foreground or BGTask)
        ▼
   presigning ──── 429 quota ──────────► failed (terminal, actionable)
        │      ──── 401 ───────────────► pending  (park; resume after re-auth)
        │      ──── network/5xx ───────► pending  (backoff, retry)
        │ 200
        ▼
    uploading ──── R2 403 sig mismatch ► failed (BUG — Sentry, do not auto-retry)
        │      ──── presign expired ───► expired ──► presigning (fresh URL, §8.5)
        │      ──── network drop ──────► uploading (NSURLSession resumes natively)
        │ 2xx
        ▼
   registering ─── network/5xx ────────► registering (retry; SAFE — see below)
        │ 201
        ▼
       done ──► delete local file, invalidate qk.meetings(), local notification
```

`registering` retries are safe because `POST /meetings` carries the server-issued
`meeting_id` from step 1 — the row already exists, so the call is idempotent in
effect. `presigning` retries are **not** safe: each call inserts a new meetings row.
A retried presign therefore orphans the previous row in `queued` state. §17 item 6
covers the cleanup; the client mitigates by never retrying a presign that already
returned a `meeting_id`.

### 8.5 Presign expiry

TTL is 3600 s. A 500 MB upload on a poor connection can exceed it — at 1 Mbit/s,
500 MB takes ~67 minutes. Not a corner case; it is the worst-case user on a train.

Handling: record `presignExpiresAt` at presign time. If the PUT fails *and*
`Date.now() > presignExpiresAt`, transition to `expired` and request a **fresh
presigned URL for the same `meeting_id`** rather than creating a new meeting.

This requires a backend affordance that may not exist. §17 item 6:
`POST /meetings/:id/upload-url` (re-presign for an existing queued meeting).
Without it, the only recovery is to abandon the row and start over, orphaning a
`queued` meeting and re-uploading from zero. For 1.0, a warning at pick time —
*"This file is large; keep EchoBrief open on Wi-Fi"* — is a poor substitute.
Recommend building item 6.

### 8.6 Behaviour on app kill

| Kill type | Upload | Recovery |
|---|---|---|
| System reclaims memory (backgrounded) | **Continues** — background `NSURLSession` is OS-owned | App relaunches on completion; reconcile from the queue |
| User force-quits (swipe up) | **iOS suspends the background session** | On next launch, `NSURLSession` reconnects and reports; queue reconciles from persisted state |
| Device reboot | Suspended | Resumes on next launch |
| Crash | Session survives the process | Reconciled at next launch |

**Reconciliation at every cold start**, in this order:

1. Load the persisted queue.
2. For each job in `uploading`, ask the OS whether the background task completed
   while the app was dead.
3. For each job in `registering`, call `GET /meetings/:id` — if it exists and is
   past `queued`, the registration landed; mark `done`.
4. For each job whose `localUri` no longer exists on disk, mark `failed` with
   `file_missing` (the user deleted it, or iOS cleaned it up — should be
   impossible in the documents directory, so report to Sentry if seen).
5. For jobs stuck >24 h, mark `failed` and surface them.

**Deliberate 1.0 constraint: one upload at a time.** Serial, FIFO. Parallel uploads
compete for the same bandwidth, make progress reporting incoherent, and multiply
the presign-expiry risk. There is no user benefit — total time is bandwidth-bound.

### 8.7 Import paths

| Source | Module | Notes |
|---|---|---|
| Share sheet (Voice Memos, Zoom, Mail) | `expo-share-intent` 8.0.1 | Requires a native Share Extension target. Highest third-party risk (§18). |
| Files.app | `expo-document-picker` 57.0.1 | First-party, low risk |

Both paths run the same validation before enqueueing, and each rejection has a
specific message rather than a generic failure:

```ts
const ACCEPTED = new Set([
  'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4',
  'audio/m4a', 'audio/x-m4a', 'audio/webm', 'video/mp4', 'video/webm',
]);
const MAX_BYTES = 500 * 1024 * 1024;
const MAX_DURATION_SEC = 4 * 60 * 60;
```

iOS often hands over a UTI rather than a MIME type, and the mapping is not always
what you expect: `.m4a` files exported from Voice Memos may arrive as
`com.apple.m4a-audio`, and `.caf` as `com.apple.coreaudio-format` — the latter maps
to `audio/x-caf`, **which the API rejects**. Extension-based inference is the
fallback, and `audio/aac` / `audio/x-caf` are the two gaps §17 item 1 closes. Until
then the app must reject them with an honest message rather than letting the server
400: *"CAF audio isn't supported yet. Export as M4A from Voice Memos."*

> **▸ SwiftUI divergence.** Everything in §8.2–8.6 would be `URLSession` with a
> `background(withIdentifier:)` configuration and `urlSession(_:didCompleteWithError:)`
> in the app delegate — the same OS machinery `expo-file-system` wraps, but with
> direct access to `URLSessionTaskDelegate` for finer progress and resume-data
> handling. The share extension would be a native target rather than a
> third-party config plugin, removing the §18 risk entirely.

---

## 9. Offline & caching

### 9.1 Principle

Meeting content is **immutable once processed**. A completed transcript, summary,
and speaker list never change. That is unusually friendly to caching: for the
dominant content type there is no invalidation problem at all, only a freshness
problem for the list.

### 9.2 Persistence

```ts
// mobile/src/lib/query/client.ts
import { QueryClient } from '@tanstack/react-query';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 7 * 24 * 60 * 60 * 1000,   // 7 days — must exceed maxAge below
      retry: retryPolicy,                 // §6.3
      refetchOnWindowFocus: false,        // RN has no window focus; §9.5 handles it
      networkMode: 'offlineFirst',        // serve cache, don't error, when offline
    },
    mutations: { networkMode: 'online', retry: 0 },
  },
});

persistQueryClient({
  queryClient,
  persister: createAsyncStoragePersister({
    storage: AsyncStorage,
    key: 'echobrief.query-cache',
    throttleTime: 2_000,
  }),
  maxAge: 7 * 24 * 60 * 60 * 1000,
  buster: `${APP_VERSION}:${SCHEMA_VERSION}`,   // bumping either invalidates all
  dehydrateOptions: {
    shouldDehydrateQuery: (q) =>
      q.state.status === 'success' && !NEVER_PERSIST.has(q.queryKey[0] as string),
  },
});
```

`NEVER_PERSIST` covers chat responses (conversational, not content), search results
(query-specific and stale immediately), and signed audio URLs (they expire — see
§9.4).

`networkMode: 'offlineFirst'` is the important line. The default `'online'` makes
queries *pause* when offline; `'offlineFirst'` serves cached data and marks it
stale, which is the behaviour a user in a subway expects.

### 9.3 What works offline

| Feature | Offline | Notes |
|---|---|---|
| Meetings list | ✅ | Last-fetched page 1 |
| Meeting detail — summary, action items, speakers, score | ✅ | Immutable once complete |
| Transcript | ✅ | Same query as detail |
| **Audio playback** | ⚠️ **Only for locally-recorded files not yet cleaned up** | Server audio is a signed R2 URL. 1.0 does not download audio for offline playback. |
| Action item toggle | ✅ **queued** | Optimistic; syncs on reconnect (§9.5) |
| **Record** | ✅ **fully** | Deliberate: recording must never depend on the network |
| Upload | ⏸ queued | §8 |
| Search | ❌ | Server-side pgvector |
| Chat | ❌ | Streaming LLM |
| Login | ❌ | Explicit "You're offline" state, not a generic error |

The two rows worth defending: recording works fully offline because a recording app
that fails in a basement conference room is not a recording app. And action-item
toggles queue offline because that is the one write a user makes while reviewing a
meeting on a plane.

### 9.4 Signed audio URLs — the cache trap

`createSignedReadUrl` (`src/server/services/r2.ts:83`) defaults to **600 seconds**.
If the meeting-detail response embeds that URL and the response is cached for days,
playback breaks ten minutes after first fetch — and it breaks *silently*, as a
player that will not start.

Mitigation, in order of preference:

1. Fetch the audio URL through a **separate, short-lived, never-persisted query**
   (`staleTime: 5min`, `gcTime: 9min`) rather than reading it off the cached detail
   payload.
2. On any playback failure, invalidate that query and retry once before showing an
   error.
3. §17 item 7: raise the read TTL to ~4 hours, or add a dedicated
   `GET /meetings/:id/audio-url` endpoint. A 600 s URL is sized for a web page that
   starts playing immediately, not a mobile app that may resume 20 minutes later.

### 9.5 Optimistic updates

Only one mutation in 1.0 scope is optimistic: the action-item completion toggle.
It is the right one — it is a binary flip, it is the most frequently tapped control
in the app, and a spinner on it would feel broken.

```ts
useMutation({
  mutationFn: (v) => api.request(`/action-items/${v.id}`, { method: 'PATCH', body: { completed: v.completed } }),
  onMutate: async (v) => {
    await queryClient.cancelQueries({ queryKey: qk.actionItems() });
    const previous = queryClient.getQueryData(qk.actionItems());
    queryClient.setQueryData(qk.actionItems(), (old) => toggleIn(old, v.id, v.completed));
    return { previous };
  },
  onError: (_e, _v, ctx) => {
    queryClient.setQueryData(qk.actionItems(), ctx?.previous);   // roll back
    toast.error('Could not update. Try again.');
  },
  onSettled: () => queryClient.invalidateQueries({ queryKey: qk.actionItems() }),
});
```

**Conflict handling** is deliberately last-write-wins, and that is defensible here:
the field is a boolean, the concurrent-editor scenario requires the same user on
two devices within seconds, and the cost of being wrong is one tap. Anything more
sophisticated would be engineering theatre. `onSettled` invalidation means the
server's value wins within a second regardless.

**Offline queueing**: with `networkMode: 'online'` on mutations, TanStack Query
pauses them while offline and resumes on reconnect, replaying in order.
`onlineManager` is wired to `expo-network` state so the library knows when that is.

**One rule, stated explicitly:** *no optimistic updates on upload or recording.*
Those are multi-step, expensive, and failure-prone; showing a meeting that does not
exist yet and then removing it is worse than showing an honest progress row.

---

## 10. State management

### 10.1 The split

| Lives in | Contains | Why |
|---|---|---|
| **TanStack Query** | Meetings, transcripts, action items, speakers, workspaces, subscription/quota, search results | Server-owned, cacheable, invalidatable. Already how the web app works. |
| **Zustand** | Session status, active workspace id, theme, upload queue, recorder state, playback position | Client-owned. No server representation, or needs synchronous reads. |
| **React local state** | Form inputs, sheet open/closed, scroll offsets, streaming text buffers | Ephemeral. Never leaves the component. |

The failure mode to avoid is duplicating server data into Zustand "so it's easier
to get at." That produces two sources of truth that drift, and it is the single most
common way React Native apps rot. If it came from the API, it lives in Query.

### 10.2 Stores

**`sessionStore`** — the §5.6 machine. `{ status, userId, email, expiresAt }` plus
`authenticate` / `expire` / `logout`. Read synchronously by route guards.

**`workspaceStore`** — `{ activeWorkspaceId }`, persisted to AsyncStorage, read
synchronously by the API client on every request. Switching workspaces sets the id
then calls `queryClient.clear()` — **not** `invalidateQueries`. Invalidation leaves
the previous workspace's data visible while refetching, which means one workspace's
meeting titles flash on screen while another workspace is selected. In a product
that partitions data by workspace, that is a data-leak-shaped bug even though no
data actually leaks.

The `onWorkspaceReset` callback (§3.4) fires when the server 403s a stale id; the
store clears and the client retries header-less, letting the server fall back to the
oldest workspace. Same self-heal as web, no `window` involved.

**`uploadStore`** — the §8.3 queue. Zustand is the coordination layer; AsyncStorage
is the durable layer. A `subscribe` writes through on every state change.

**`recorderStore`** — `{ status, elapsedMs, meterLevel, interruptedAt }`. Ticks at
10 Hz while recording. Kept out of Query entirely: it is high-frequency, ephemeral,
and never server-backed.

**`themeStore`** — `'light' | 'dark' | 'system'`, persisted. Mirrors the web app's
`echobrief-theme` semantics. Tokens are a hand-written TS object mirroring the OKLCH
values in `src/styles.css`; **both themes are first-class**, per the project
convention, and every screen must be reviewed in both.

### 10.3 Provider composition

```tsx
// mobile/app/_layout.tsx
<QueryClientProvider client={queryClient}>
  <ApiClientProvider client={apiClient}>        {/* §3.5 — shared hooks read this */}
    <ThemeProvider>
      <SafeAreaProvider>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <Stack />
        </GestureHandlerRootView>
      </SafeAreaProvider>
    </ThemeProvider>
  </ApiClientProvider>
</QueryClientProvider>
```

Zustand stores need no providers — they are module singletons, which is precisely
why the API client can read `useWorkspaceStore.getState()` synchronously without a
React tree.

---

## 11. Error handling & observability

### 11.1 Taxonomy

Every error in the app maps to exactly one row. The rule: **the user is told what
happened and what to do, never what the status code was.**

| Class | Trigger | User-facing copy | Recovery | Sentry |
|---|---|---|---|---|
| `offline` | No connectivity | "You're offline. We'll sync when you're back." | Auto on reconnect | No |
| `timeout` | §6.5 budget | "That took too long. Try again." | Retry button | Breadcrumb |
| `server` | 5xx | "Something went wrong on our end. We're looking into it." | Auto-retry ×3 | **Yes** |
| `auth_expired` | 401, non-`/auth` | "Your session expired. Sign in to continue." | → login, email pre-filled | Breadcrumb |
| `auth_invalid` | 401 on `/auth/*` | "Incorrect email or password." | Inline | No |
| `rate_limited` | 429 + `Retry-After` | "Too many attempts. Try again in 4:32." | Countdown-disabled button | Breadcrumb |
| `quota_exceeded` | 429 `quota_exceeded` | "You've used all {limit} meetings on {tier}. Upgrade to continue." | Deep link to web upgrade | Breadcrumb + metric |
| `validation` | 400 + `details` | Field-level from `details` | Inline | No |
| `not_found` | 404 | "This meeting no longer exists." | → list, evict cache | No |
| `forbidden` | 403, not stale-workspace | "You don't have access to this." | → list | **Yes** (likely a bug) |
| `upload_signature` | R2 403 | "Upload failed. Tap to retry." | Re-presign | **Yes — always a bug** |
| `upload_size_drift` | §8.2 guard | Same | Re-measure, re-presign | **Yes — always a bug** |
| `stream_unsupported` | §6.7 guard | "Chat isn't available in this build." | None | **Yes — build defect** |
| `mic_denied` | Permission denied | "EchoBrief needs microphone access to record." | Open Settings | No |
| `storage_full` | <500 MB free | "Not enough storage to record. Free up space." | None | No |
| `unsupported_media` | MIME rejected | "That file type isn't supported. Try M4A, MP3, or WAV." | Pick another | Metric only |
| `unknown` | Anything else | "Something went wrong." + request id | Retry | **Yes** |

Three rows carry a standing instruction: `upload_signature`, `upload_size_drift`,
and `stream_unsupported` are **never** user error and **never** transient. Each one
firing in production means §8.1 or §6.7 is wrong. They should alert, not just log.

### 11.2 Crash reporting

`@sentry/react-native` 8.22.0 ([npm](https://www.npmjs.com/package/@sentry/react-native)).
Set up via `npx @sentry/wizard@latest -i reactNative`, which configures the Metro
integration ([Expo docs](https://docs.expo.dev/guides/using-sentry/)). Requires a
development build — it will not run in Expo Go.

```ts
// mobile/src/services/telemetry.ts
import * as Sentry from '@sentry/react-native';
import { config } from '@/config';

Sentry.init({
  dsn: config.sentryDsn,
  environment: config.variant,               // development | staging | production
  release: `${config.bundleId}@${config.version}+${config.buildNumber}`,
  enabled: config.variant !== 'development',
  tracesSampleRate: config.variant === 'production' ? 0.1 : 1.0,
  attachStacktrace: true,
  sendDefaultPii: false,                     // §13
  beforeSend(event) {
    // Belt and braces against exfiltrating meeting content through error payloads.
    if (event.request?.headers) {
      delete event.request.headers.authorization;
      delete event.request.headers.Authorization;
    }
    return scrubTranscriptText(event);
  },
});
```

Source maps upload automatically on EAS Build when `SENTRY_AUTH_TOKEN` is set as a
sensitive env var.

### 11.3 What is logged, and what is not

**Logged:** request id, method, path template (`/meetings/:id`, never the id),
status, duration; screen transitions; upload state transitions with byte counts;
recording lifecycle including every interruption; session transitions; app
foreground/background; network reachability changes.

**Never logged, under any circumstance:** the JWT or any fragment of it; transcript
text; summary text; chat messages; meeting titles; email addresses; audio file
contents or paths containing user-identifiable names.

The distinction is the product's whole trust proposition. EchoBrief holds recordings
of private meetings. A transcript fragment in a Sentry breadcrumb is a confidentiality
breach, not a logging mistake. `beforeSend` enforces it mechanically because review
will not catch every case.

**User identification:** `Sentry.setUser({ id: userId })` — the opaque uuid only.
No email, no name.

### 11.4 Error boundaries

Three levels, so a failure degrades rather than white-screens:

1. **Root** — catches anything unhandled, shows a recovery screen with a "Restart"
   button and the request id.
2. **Route** — per expo-router screen; a broken meeting detail must not take down
   the tab bar.
3. **Component** — around the transcript renderer and the chat stream specifically,
   because both handle unbounded server-controlled content.

---

## 12. Environments & configuration

### 12.1 Matrix

| | development | staging | production |
|---|---|---|---|
| `APP_VARIANT` | `development` | `staging` | `production` |
| Bundle id | `ai.echobrief.app.dev` | `ai.echobrief.app.staging` | `ai.echobrief.app` |
| Display name | EchoBrief Dev | EchoBrief Staging | EchoBrief |
| Icon | Blue tint + "DEV" | Orange tint + "STG" | Production |
| `EXPO_PUBLIC_API_URL` | `http://192.168.x.x:4000` | production API (until a staging API exists) | `https://api-production-5cfb.up.railway.app` |
| Sentry | disabled | enabled, 100% traces | enabled, 10% traces |
| Debug screen | visible | visible | **hidden** (7-tap unlock) |
| Distribution | `expo run:ios` / dev build | TestFlight internal | App Store |

Distinct bundle ids mean all three install side by side — which is what makes
"is this build actually pointing at staging?" answerable by looking at the home
screen, and lets a tester keep a working production app while testing a broken one.

**There is no staging backend today.** Staging builds point at production. That is
a real limitation: it means TestFlight testers create real meetings, consume real
quota, and spend real OpenAI money. Options are (a) accept it and use a dedicated
test account with a high quota, or (b) deploy a second Railway environment. For 1.0,
(a), with the constraint written down here so it is a decision and not an accident.

### 12.2 `app.config.ts`

```ts
// mobile/app.config.ts
import type { ExpoConfig, ConfigContext } from 'expo/config';

type Variant = 'development' | 'staging' | 'production';
const variant = (process.env.APP_VARIANT ?? 'development') as Variant;

const BUNDLE_ID: Record<Variant, string> = {
  development: 'ai.echobrief.app.dev',
  staging: 'ai.echobrief.app.staging',
  production: 'ai.echobrief.app',
};
const NAME: Record<Variant, string> = {
  development: 'EchoBrief Dev',
  staging: 'EchoBrief Staging',
  production: 'EchoBrief',
};

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: NAME[variant],
  slug: 'echobrief',
  version: '1.0.0',
  orientation: 'portrait',
  scheme: 'echobrief',
  userInterfaceStyle: 'automatic',          // both themes are first-class
  newArchEnabled: true,
  icon: `./assets/icon-${variant}.png`,

  ios: {
    bundleIdentifier: BUNDLE_ID[variant],
    supportsTablet: false,                  // 1.0 is iPhone-only
    buildNumber: process.env.EAS_BUILD_NUMBER ?? '1',
    infoPlist: {
      UIBackgroundModes: ['audio'],
      NSMicrophoneUsageDescription:
        'EchoBrief uses the microphone to record meetings you choose to capture.',
      ITSAppUsesNonExemptEncryption: false, // HTTPS only; avoids per-release export forms
    },
    privacyManifests: PRIVACY_MANIFEST,     // §13.5
  },

  plugins: [
    'expo-router',
    'expo-secure-store',
    ['expo-audio', {
      microphonePermission:
        'EchoBrief uses the microphone to record meetings you choose to capture.',
      enableBackgroundRecording: true,
    }],
    ['expo-build-properties', { ios: { deploymentTarget: '17.0' } }],
    ['expo-share-intent', { iosActivationRules: { NSExtensionActivationSupportsFileWithMaxCount: 1 } }],
    '@sentry/react-native/expo',
  ],

  extra: {
    variant,
    eas: { projectId: process.env.EAS_PROJECT_ID },
  },
});
```

### 12.3 `eas.json`

```jsonc
{
  "cli": { "version": ">= 21.8.0", "appVersionSource": "remote" },
  "build": {
    "base": {
      "node": "20.19.0",
      "ios": { "resourceClass": "m-medium" }
    },
    "development": {
      "extends": "base",
      "developmentClient": true,
      "distribution": "internal",
      "env": {
        "APP_VARIANT": "development",
        "EXPO_PUBLIC_API_URL": "http://192.168.1.50:4000",
        "EXPO_PUBLIC_ENV": "development"
      }
    },
    "staging": {
      "extends": "base",
      "distribution": "internal",
      "autoIncrement": true,
      "env": {
        "APP_VARIANT": "staging",
        "EXPO_PUBLIC_API_URL": "https://api-production-5cfb.up.railway.app",
        "EXPO_PUBLIC_ENV": "staging",
        "EXPO_PUBLIC_SENTRY_DSN": "$SENTRY_DSN_MOBILE"
      }
    },
    "production": {
      "extends": "base",
      "distribution": "store",
      "autoIncrement": true,
      "env": {
        "APP_VARIANT": "production",
        "EXPO_PUBLIC_API_URL": "https://api-production-5cfb.up.railway.app",
        "EXPO_PUBLIC_ENV": "production",
        "EXPO_PUBLIC_SENTRY_DSN": "$SENTRY_DSN_MOBILE"
      }
    }
  },
  "submit": {
    "production": {
      "ios": { "appleTeamId": "$APPLE_TEAM_ID", "ascAppId": "$ASC_APP_ID" }
    }
  }
}
```

> **The inlining trap.** `EXPO_PUBLIC_*` variables are **inlined into the bundle by
> Metro at build time**. Changing `EXPO_PUBLIC_API_URL` requires a rebuild — a
> restart does nothing. This is the exact same failure the web deploy already hit
> with `VITE_API_URL` baked into the Docker image at build time (see the project
> CLAUDE.md). Same class of bug, different bundler. The debug screen below exists
> mainly so that this failure is diagnosable in ten seconds instead of an hour.

### 12.4 LAN development

The API already binds `0.0.0.0`, so a device on the same Wi-Fi reaches
`http://192.168.x.x:4000` directly. Two iOS-specific facts:

- **ATS**: Expo's prebuild `Info.plist` template already ships
  `NSAllowsLocalNetworking: true`, so cleartext HTTP to a private-range address is
  permitted on iOS 17+ dev builds with **no config change**.
- **Local Network Privacy** is a *separate* mechanism and still prompts. iOS shows
  *"EchoBrief Dev would like to find and connect to devices on your local network."*
  Denying it breaks LAN dev in a way that looks like a network bug. If a developer
  ever taps "Don't Allow," the only fix is Settings → Privacy → Local Network.
  Document it in the mobile README; it will cost someone an afternoon otherwise.

The host IP changes with the network, so `scripts/dev-ip.mjs` writes the current
LAN IP into `mobile/.env.development.local` before `expo start`.

### 12.5 The debug screen

Reachable in dev/staging from Settings; in production via seven taps on the version
label. It answers "what is this build actually doing" without a debugger:

```
ENVIRONMENT
  Variant              staging
  Bundle id            ai.echobrief.app.staging
  API base URL         https://api-production-5cfb.up.railway.app/api/v1
  API /health          ✓ 142ms · env=production · v2026.08.01   ← §17 item 3
  Sentry               enabled · staging · 100%

BUILD
  App version          1.0.0 (47)
  Expo SDK             57.0.12
  RN                   0.87.0 · New Architecture: ON
  Hermes               ON
  Build profile        staging
  Commit               a3f9c21
  Built at             2026-08-12T09:14:00Z

SESSION
  Status               authenticated
  User id              8f3e…c21a          (tap to copy)
  Token expires        2026-08-19 14:22 (in 6d 22h)
  Active workspace     4b2d…9e01
  Streaming support    ✓ ReadableStream available   ← §6.7 canary

STORAGE
  Query cache          2.4 MB · 38 queries
  Upload queue         1 pending · 0 failed
  Recordings on disk   2 files · 41.2 MB
  Free space           18.4 GB

ACTIONS
  [Ping /health]  [Test stream]  [Clear query cache]  [Force token expiry]  [Copy diagnostics]
```

"API base URL" and "env" side by side is the single highest-value pairing on this
screen: it catches the §12.3 inlining trap immediately, and it catches a staging
build pointed at production, which is otherwise invisible.

---

## 13. Security requirements

### 13.1 Token handling

| Requirement | Implementation |
|---|---|
| Never in AsyncStorage | Keychain via `expo-secure-store` only. Lint rule bans the string `auth.jwt` outside `token-store.ts`. |
| Never logged | `beforeSend` strips `authorization`; a Sentry `beforeBreadcrumb` redacts any string matching `/^ey[A-Za-z0-9_-]{10,}\./`. |
| Never in a deep link | The web-handoff (§17 item 2) uses a **single-use, 60-second** token, not the JWT. |
| Cleared on logout | §5.8 |
| Device-scoped | `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` — no iCloud Keychain sync |

### 13.2 No secrets in the bundle

**`EXPO_PUBLIC_*` values are plaintext in the app binary.** Anyone can extract them
with `unzip` on the `.ipa` and `strings` on the bundle. Non-negotiable rules:

| May be `EXPO_PUBLIC_*` | Must never be |
|---|---|
| API base URL | `AUTH_SECRET` (JWT signing key) |
| Sentry DSN (write-only by design) | `OPENAI_API_KEY`, `ASSEMBLYAI_API_KEY` |
| App variant, version | R2 credentials |
| Feature flags | `DATABASE_URL`, `REDIS_URL` |
| | `INTEGRATION_TOKEN_ENCRYPTION_KEY` |

The architecture already makes this easy — the app talks only to the API, and the
API holds every third-party credential. The app has no reason to know any of them.
Gitleaks already runs in the existing CI; extend its scope to `mobile/` (§15.3).

The corollary is worth stating: **JWT verification cannot happen on the client**,
because that would require `AUTH_SECRET` in the bundle. §5.5's `decodeJwt` is
explicitly unverified decoding, used only to schedule UI. It must never gate an
authorization decision.

### 13.3 Transport

- HTTPS only in staging/production; enforced by ATS defaults.
- Cleartext permitted **only** for private-range addresses in development, via the
  `NSAllowsLocalNetworking` already in Expo's template. No `NSAllowsArbitraryLoads`
  — ever, in any profile.
- **Certificate pinning: no, for 1.0.** Railway rotates certificates on its own
  schedule; a pinned app that ships to the App Store cannot be updated fast enough
  when that happens, and the failure mode is *every user offline until an App Store
  review clears*. The threat it defends against (an attacker with a device-trusted
  root CA) is not in our model for a productivity app. Revisit only with a backup-pin
  strategy and a remote kill switch.

### 13.4 Jailbreak posture

**Detect and report, never block.** A jailbreak check tags the Sentry scope
(`device.jailbroken: true`) so anomalous crash clusters can be correlated. The app
does not degrade or refuse to run: jailbreak detection is trivially bypassable, it
produces false positives on developer devices, and blocking punishes a handful of
legitimate power users while stopping no determined attacker. The real defence is
that the Keychain item is device-scoped and the token expires in 7 days.

### 13.5 Privacy manifest

Apple requires `PrivacyInfo.xcprivacy` declaring required-reason API usage. Expo
does **not** auto-generate it — it is configured through `ios.privacyManifests` in
the app config ([Expo docs](https://docs.expo.dev/guides/apple-privacy/)). Expo SDK
packages ship their own manifests inside `node_modules/<pkg>/ios/PrivacyInfo.xcprivacy`,
which is where to look for the exact reasons each module needs.

```ts
const PRIVACY_MANIFEST = {
  NSPrivacyTracking: false,
  NSPrivacyTrackingDomains: [],
  NSPrivacyCollectedDataTypes: [
    {
      NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeAudioData',
      NSPrivacyCollectedDataTypeLinked: true,
      NSPrivacyCollectedDataTypeTracking: false,
      NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
    },
    {
      NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeEmailAddress',
      NSPrivacyCollectedDataTypeLinked: true,
      NSPrivacyCollectedDataTypeTracking: false,
      NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
    },
    {
      NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeCrashData',
      NSPrivacyCollectedDataTypeLinked: false,
      NSPrivacyCollectedDataTypeTracking: false,
      NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
    },
  ],
  NSPrivacyAccessedAPITypes: [
    {
      NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp',
      NSPrivacyAccessedAPITypeReasons: ['C617.1'],   // files created by this app
    },
    {
      NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
      NSPrivacyAccessedAPITypeReasons: ['CA92.1'],   // app's own defaults (AsyncStorage)
    },
    {
      NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryDiskSpace',
      NSPrivacyAccessedAPITypeReasons: ['E174.1'],   // §7.4 pre-recording space check
    },
  ],
};
```

`NSPrivacyTracking: false` and an empty `NSPrivacyTrackingDomains` are accurate —
there is no advertising SDK, no attribution SDK, and no cross-app identifier. Keep
it that way; adding one changes the App Store privacy label materially.

**UNVERIFIED**: the exact reason codes each SDK-57 module needs. Verify by reading
each dependency's bundled manifest before the first submission. Apple also reports
missing reasons after upload, so the first TestFlight submission is itself a check.

### 13.6 Other

| Item | Decision |
|---|---|
| Screenshot protection | Not for 1.0. iOS gives no reliable API, and the content is the user's own. |
| Biometric app lock | 1.1 (§5.2) |
| Clipboard | Copy is explicit and user-initiated only |
| Pasteboard privacy | No programmatic reads — avoids the iOS paste banner entirely |
| Audio at rest | Files sit in the app container, protected by iOS Data Protection (Complete Until First User Authentication, matching the Keychain class) |
| Audio in transit | TLS 1.3 to R2 |
| Third-party SDK count | Sentry only. Every additional SDK is a new privacy-manifest obligation and a new data-flow to justify. |

---

## 14. Testing strategy

### 14.1 The pyramid, and where the real risk sits

The unusual property of this app is that its hardest logic (§5 session machine, §6
retry and 429 classification, §8 upload state machine) is **pure TypeScript with no
platform dependency**, and therefore testable in plain Node — in the repo's
*existing* vitest suite, on the *existing* Linux CI runners, with no simulator.
That is not an accident; it is what §1.3's boundary rule buys.

The corollary is that everything *not* testable that way — audio, background
upload, share extension — is exactly where the risk concentrates and where manual
device testing is unavoidable.

| Layer | Tool | Runs on | Covers |
|---|---|---|---|
| Unit (shared) | **vitest** (existing) | Linux CI ✅ | Schemas, client factory, retry, 429 classifier, JWT decode, session machine, upload machine |
| Unit (mobile) | jest-expo 57.0.4 | Linux CI ✅ | Hooks, formatters, transcript binary search |
| Component | @testing-library/react-native 14.0.1 | Linux CI ✅ | Screens with mocked services |
| Integration | vitest against the real API | Linux CI ⚠️ (needs a token) | Auth, list, upload presign, streaming |
| E2E | Maestro | macOS only ❌ | Login → record → upload → view |
| Manual | Human + iPhone 15 | — | Audio, interruptions, background upload, share sheet |

### 14.2 Unit tests — the ones that matter most

Written first, before UI:

```ts
// packages/shared/src/api/__tests__/client.test.ts
describe('createApiClient', () => {
  it('injects Authorization from the token store synchronously', ...);
  it('omits Authorization when the token is null', ...);
  it('injects X-Workspace-Id only when a workspace is set', ...);
  it('clears the token and calls onUnauthorized on a 401 outside /auth/*', ...);
  it('does NOT clear the token on a 401 from /auth/login', ...);   // anti-enumeration
  it('self-heals a stale workspace: clears, notifies, retries exactly once', ...);
  it('does not retry the workspace self-heal twice', ...);         // infinite-loop guard
  it('classifies quota_exceeded as terminal (retryAfterMs undefined)', ...);
  it('classifies a bare 429 as rate_limit and reads Retry-After', ...);
  it('throws stream_unsupported when fetchImpl yields a body-less response', ...);
});
```

That last test is the regression guard for §6.7 — it fails loudly if anyone swaps
`expo/fetch` back to the global.

Two smoke tests must run **on device**, because they assert things Node cannot see:

```ts
// mobile/src/__tests__/smoke.native.test.ts
it('resolves exactly one copy of React', () => {
  // §2.5 duplicate-React guard. Fails if metro.config.js resolution regresses.
  expect(require.resolve('react')).toContain('/mobile/node_modules/react');
});
it('has atob available in Hermes', () => {
  expect(typeof globalThis.atob).toBe('function');   // §5.5 dependency
});
```

### 14.3 Integration against the real API

Runs against production with a dedicated `mobile-ci@echobrief.test` account. Guarded
by an env var so it skips when credentials are absent.

Critical cases, in priority order:

1. **Signup → login → JWT decodes with an `exp` ~7 days out.** Proves §5.5.
2. **Streaming chat yields more than one chunk, with measurable time between the
   first and last.** Proves §6.7 end to end. Highest-value single test in the suite.
3. **`/search` returns a decodable `x-citations` header.**
4. **Full upload round trip** with a small fixture: presign → PUT with exact
   `content-length` → `POST /meetings` → poll to `complete`.
5. **`content-length` mismatch is rejected.** Deliberately PUT one byte short and
   assert a 403. Pins the §8.1 invariant so a future backend change that relaxes it
   is noticed.
6. **`content-type` mismatch** — asserts whichever behaviour §8.1's verification
   establishes. Written *after* that experiment, not guessed at now.
7. 401 with a garbage token; 403 with a foreign workspace id.

### 14.4 Device matrix

| Device | iOS | Priority | Why |
|---|---|---|---|
| **iPhone 15** | 17.x, 18.x | **P0** | Primary target |
| iPhone SE (3rd gen) | 17.x | P1 | Smallest supported screen (4.7"); catches every layout overflow |
| iPhone 15 Pro Max | 18.x | P2 | Largest; Dynamic Island variant |
| iPhone 12 | 17.x | P2 | Oldest plausible iOS 17 device; the performance floor for §16 |
| Simulator | 17.0 | P1 | Fast iteration. **Cannot test:** real mic, background upload, interruptions, share sheet. |

Manual test passes that no automation covers:

- Record 60 min → background the app for 30 min → foreground → verify continuity
- Record → receive a real phone call → verify auto-pause and auto-resume
- Record → force-quit → relaunch → verify §7.4 recovery
- Upload 200 MB on throttled 3G → force-quit mid-upload → relaunch → verify resume
- Share a Voice Memo from the iOS share sheet
- Airplane mode → record → re-enable → verify the queue drains
- Every screen in light and dark, at Dynamic Type sizes XS through XXXL
- VoiceOver on the meeting list and detail

### 14.5 Coverage targets

| Area | Target | Rationale |
|---|---|---|
| `packages/shared` | **90%** | Pure logic, no excuse. Shared with production web. |
| Session + upload machines | **100% of transitions** | Every transition in §5.6 and §8.4 has a named test |
| Mobile hooks/utils | 70% | — |
| Screens | 40% | Diminishing returns; Maestro covers the flows |
| Native wrappers | 0% automated | Manual only — mocking `expo-audio` tests the mock |

---

## 15. CI/CD

### 15.1 Relationship to the three existing workflows

`ci-backend.yml`, `ci-frontend.yml`, and `ci-responsible-ai.yml` exist and pass
today. **They must not be modified**, other than adding a path filter so they do not
run on mobile-only changes. A fourth workflow is added.

```yaml
# Added to ci-frontend.yml and ci-backend.yml
on:
  push:
    branches: [main, staging]
    paths-ignore: ['mobile/**', 'docs/**']
  pull_request:
    branches: [main, staging]
    paths-ignore: ['mobile/**', 'docs/**']
```

Note the asymmetry, and that it is deliberate: **`packages/shared/**` is
intentionally absent from `paths-ignore`.** A change to shared code is a change to
the production web app and must run the full backend and frontend pipelines. That
is the whole point of sharing the file.

### 15.2 `ci-mobile.yml`

```yaml
name: Mobile Pipeline

on:
  push:
    branches: [main, staging]
    paths: ['mobile/**', 'packages/shared/**', '.github/workflows/ci-mobile.yml']
  pull_request:
    branches: [main, staging]
    paths: ['mobile/**', 'packages/shared/**']

jobs:
  shared-contract:
    name: Shared Package Contract
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      # The §1.3 invariant, enforced mechanically rather than by review.
      - name: Assert shared/ is platform-free
        run: |
          if grep -rEn "from ['\"](react-native|expo|expo-|@react-native)" packages/shared/src; then
            echo "::error::packages/shared must not import platform modules (TRD §3.6)"
            exit 1
          fi
      - name: Shared unit tests (runs in the EXISTING vitest suite)
        run: npx vitest run packages/shared

  typecheck:
    name: Typecheck
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm, cache-dependency-path: mobile/package-lock.json }
      - run: npm ci --prefix mobile
      - run: npx tsc --noEmit -p mobile/tsconfig.json

  lint:
    name: Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm, cache-dependency-path: mobile/package-lock.json }
      - run: npm ci --prefix mobile
      - run: npx eslint mobile --max-warnings 0

  unit:
    name: Unit + Component Tests
    runs-on: ubuntu-latest
    needs: [typecheck]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm, cache-dependency-path: mobile/package-lock.json }
      - run: npm ci --prefix mobile
      - run: npm --prefix mobile test -- --ci --coverage

  gitleaks:
    name: Gitleaks (mobile)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: gitleaks/gitleaks-action@v2
        env: { GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}' }

  # No EAS build on PRs. Costs money and minutes; the gates above catch what
  # a build would catch, minus native-link errors. Builds are triggered by tag.
  eas-build-staging:
    name: EAS Build (staging)
    runs-on: ubuntu-latest
    needs: [shared-contract, typecheck, lint, unit]
    if: github.ref == 'refs/heads/staging' && github.event_name == 'push'
    steps:
      - uses: actions/checkout@v4
      - uses: expo/expo-github-action@v8
        with: { eas-version: latest, token: '${{ secrets.EXPO_TOKEN }}' }
      - run: npm ci --prefix mobile
      - run: eas build --platform ios --profile staging --non-interactive --no-wait
        working-directory: mobile
```

### 15.3 What CI can and cannot do

| Task | Linux runner | Notes |
|---|---|---|
| Typecheck, lint, unit, component | ✅ | Everything in §14.1's top four rows |
| Shared-package contract check | ✅ | The grep gate above |
| Gitleaks | ✅ | Already the project's pattern |
| Integration vs. real API | ✅ | Needs `MOBILE_CI_EMAIL` / `MOBILE_CI_PASSWORD` secrets |
| **EAS Build** | ✅ | Runs on EAS's macOS infrastructure, triggered from Linux |
| **Maestro E2E** | ❌ | Needs a macOS runner + simulator. `macos-latest` is ~10× the minutes. **Recommendation: run Maestro locally before each release, not in CI.** |
| Native module compilation errors | ❌ (PR) / ✅ (EAS) | The gap: a broken config plugin passes every PR gate and fails at build. Mitigate with a nightly scheduled EAS build on `main`. |

That last row is the honest limitation of this pipeline. A config-plugin or
native-linking regression is invisible until an EAS build runs. The nightly build
is the cheapest fix; a per-PR build is the thorough one and costs real money.

### 15.4 Release flow

```
feature branch → PR → ci-mobile gates → merge to staging
     └─► EAS build (staging) → TestFlight internal → manual device pass (§14.4)
            └─► merge staging → main → tag v1.0.0
                   └─► eas build --profile production
                          └─► eas submit → App Store Review → phased release
```

Local device builds during development use `npx expo run:ios --device` — faster
than EAS for iteration and free, at the cost of needing Xcode locally.

---

## 16. Performance budgets

### 16.1 Startup

| Metric | Budget | Measured how |
|---|---|---|
| Cold start → first frame | **< 1.5 s** | Sentry app-start span |
| Cold start → meeting list interactive (cached) | **< 2.0 s** | Custom span |
| `hydrateTokenStore()` | **< 100 ms** | Custom span — this gates the splash (§5.3) |
| Query cache rehydration | **< 300 ms** | Custom span |
| Warm start → interactive | **< 400 ms** | — |

The 2-second figure is the one that matters: below it the app feels like it was
already running, above it the user perceives a load. Everything in §9.2's
persistence design exists to hit it.

### 16.2 Transcript rendering — the hardest path

A 2-hour meeting produces roughly 1,500–3,000 transcript segments. This is where a
naive implementation dies.

| Metric | Budget | Design |
|---|---|---|
| Time to first segment visible | **< 400 ms** | Render the first 50; virtualize the rest |
| Scroll frame rate | **≥ 58 fps** sustained | FlatList, `getItemLayout`, memoized rows |
| Dropped frames per 10 s of fast scroll | **< 3** | — |
| Active-segment lookup | **< 1 ms** | Binary search over a memoized `start_ms[]` (§7.5) |
| Highlight update rate | 4 Hz | Deliberately not 60 Hz |
| Re-renders per position change | **≤ 2 rows** | Context-scoped active index, never a list-wide state change |
| Memory, 3,000 segments | **< 120 MB** | — |

`getItemLayout` requires fixed row heights, which conflicts with variable-length
segment text. Resolution: precompute per-segment height once from character count
and a measured line-height, cache it on the segment. Approximate but stable, and
stability is what `getItemLayout` actually needs.

### 16.3 Streaming chat

| Metric | Budget | Design |
|---|---|---|
| Time to first token visible | **< 1.5 s** after send | Bounded by GPT-5 TTFT, not by us |
| Re-renders per second while streaming | **≤ 17** | The 60 ms flush interval (§6.7) |
| Frame rate while streaming | **≥ 55 fps** | Text accumulates in a ref; only the flush touches state |
| Memory growth over a 4,000-token response | **< 10 MB** | String concat in a ref, single mounted Text node |

The naive version — `setState` per chunk — produces 100+ re-renders per second of a
continuously growing text node and visibly janks the scroll. The 60 ms throttle is
not a micro-optimization; it is the difference between working and not.

### 16.4 Lists, audio, upload

| Path | Metric | Budget |
|---|---|---|
| Meetings list | Initial render (20 items, cached) | < 200 ms |
| | Scroll | ≥ 58 fps |
| | Pull-to-refresh → updated | < 1.2 s |
| Search | Keystroke → debounced request | 300 ms debounce |
| | First result | < 2.5 s |
| Audio | Tap play → sound | < 300 ms |
| | Tap-to-seek → sound at new position | < 200 ms |
| | Recording UI overhead | < 3% CPU |
| Upload | Progress update cadence | 500 ms (not per callback) |
| | Throughput overhead vs. raw | < 5% |

### 16.5 Resource ceilings

| Resource | Budget | Note |
|---|---|---|
| Peak memory, meeting detail | **< 250 MB** | iPhone SE has the tightest headroom |
| Baseline memory, list | < 120 MB | |
| Battery, 1 h background recording | **< 8%** | Measured on iPhone 15 |
| Battery, 10 min active use | < 3% | |
| **IPA size** | **< 40 MB** | Hermes + no bundled media makes this comfortable |
| Disk, app data (excl. recordings) | < 50 MB | Query cache capped by `maxAge` |

### 16.6 Measurement

Budgets that are not measured are aspirations. Enforcement:

- Sentry Performance with custom spans on every named path above.
- A `PerformanceObserver`-backed dev overlay showing live frame rate and JS thread
  time during transcript scroll and chat streaming.
- A pre-release manual pass on iPhone 12 (the §14.4 performance floor), not just
  iPhone 15 — anything that holds on a 12 holds everywhere in the matrix.

---

## 17. Backend changes required

Ordered by value, not by effort. Estimates are for a developer already fluent in
this codebase.

### Item 1 — Extend the MIME enum · **30 min** · Priority: **Medium**

`audio/aac` and `audio/x-caf` are absent from `SupportedMime`. Recording does not
need them (§7.2 lands on `audio/mp4`), but share-sheet imports of Voice Memos
exports and some third-party recorders do.

**Files:**
- `src/lib/schemas.ts:29-39` — add `"audio/aac"`, `"audio/x-caf"`; consider `"audio/mp3"` (a common non-standard reporting of MPEG audio) and `"audio/vnd.wave"`.
- `src/server/services/r2.ts:52-66` — add matching entries to `extensionFromMime` (`aac`, `caf`), or the extension falls back to `.bin`.

**Risk:** Low, but **verify AssemblyAI accepts raw CAF**. If it does not, this trades
a clean client-side rejection for a confusing server-side pipeline failure — which is
strictly worse. Do the vendor check before shipping the enum change.

### Item 2 — Web handoff token · **4 h** · Priority: **High**

Scope says everything outside 1.0 "prompts the user to open the web app." Doing that
by sending the user to a login screen makes the handoff worthless — nobody types a
password on a phone to check a setting.

**Design:** `POST /auth/handoff` (authenticated) returns a single-use, 60-second,
opaque token stored in Redis with `SET key value EX 60 NX`. The app opens
`{APP_URL}/handoff?token=…`; the web app exchanges it for a JWT and redirects.

**Files:**
- `src/server/api/routes/auth.ts` — add `POST /handoff` (mint) and `POST /handoff/exchange` (redeem-and-delete).
- `src/routes/handoff.tsx` — new web route.
- No migration — Redis TTL is the whole storage mechanism.

**Security:** single-use enforced by `GETDEL`; 60 s TTL; bound to the minting user;
rate-limited; the token is opaque and carries no claims. Never put the JWT itself
in a URL — it lands in browser history, server logs, and `Referer` headers.

### Item 3 — `/health` environment marker · **15 min** · Priority: **High**

`GET /health` returns `{ ok, service, timestamp }` with no way to tell production
from staging. The §12.5 debug screen needs it, and so does every "which backend am
I actually hitting" question.

**File:** `src/server/api/routes/health.ts:26-32`

```ts
app.get("/health", (c) => c.json({
  ok: true,
  service: "echobrief-api",
  environment: process.env.RAILWAY_ENVIRONMENT_NAME ?? "unknown",
  version: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
  min_client_version: { ios: "1.0.0" },     // enables the §17 item 5 kill switch
  timestamp: Date.now(),
}));
```

Ratio of value to effort makes this the first thing to build.

### Item 4 — `POST /auth/refresh` · **3 h** · Priority: **Highest**

**The single most valuable backend change in this list.** A 7-day JWT with no
refresh means every mobile user is force-logged-out weekly, on a phone, with no
password manager, quite possibly mid-recording. Web tolerates this. Mobile does not.

**Design:** authenticated `POST /auth/refresh` returns a fresh 7-day JWT if the
current one is valid and the user row is active. The app calls it opportunistically
on foreground when `exp - now < 48h`. This is a sliding window, not true refresh
tokens — it does not extend a session past 7 days of total inactivity, which is the
correct security property, and it costs a fraction of a proper refresh-token
implementation.

**Files:**
- `src/server/api/routes/auth.ts` — the endpoint (reuses the existing signing helper).
- `src/server/api/middleware/rate-limit.ts` — a generous limit (say 10/hour); this must not be a DoS lever.
- No migration.

**Benefit to web as well:** the same sliding window fixes the equivalent (milder)
web annoyance.

### Item 5 — Client version gate · **1 h** · Priority: **Medium**

Ships with item 3 (`min_client_version` above). If a shipped client turns out to
have a data-losing bug — a wrong `content-length` computation, say — App Store
review latency means days of exposure with no way to stop it. A soft gate ("Update
required") checked at boot is the only remote lever a native app has.

**Files:** `src/server/api/routes/health.ts` (field), plus the app's boot check.

### Item 6 — Re-presign for an existing meeting · **2 h** · Priority: **Medium-High**

Presign TTL is 3600 s. A large upload on a slow connection outlives it (§8.5), and
today the only recovery is to abandon the meeting row and start over — orphaning a
`queued` meeting and re-uploading from byte zero.

**Design:** `POST /meetings/:id/upload-url` — for a meeting owned by the caller and
still in `queued` with no uploaded object, return a fresh presigned URL for the
**same** `audio_key`, `content_type`, and `audio_size` already on the row. No new row.

**Files:**
- `src/server/api/routes/meetings.ts` — new route; reuse `createPresignedUploadUrl` with the persisted values.
- `src/server/services/r2.ts` — no change.

**Also worth doing here:** a cleanup job for `queued` meetings older than 24 h with
no R2 object. Retried presigns and abandoned uploads leak these rows, and they will
accumulate. Roughly 1 h inside the existing `cleanup-r2` worker.

### Item 7 — Longer signed read TTL · **1 h** · Priority: **Medium**

`createSignedReadUrl` defaults to 600 s (`src/server/services/r2.ts:83`). Sized for
a web page that plays immediately; wrong for an app that caches a meeting and
resumes playback 20 minutes later. The failure is silent — a player that will not
start.

**Options:** (a) raise the default to ~4 h for the meeting-detail response; (b) add
`GET /meetings/:id/audio-url` returning a fresh short-lived URL on demand.
**(b) is better** — it keeps exposure short and gives the client a clean retry path
(§9.4) — but (a) is a one-line change and adequate for 1.0.

**File:** `src/server/services/r2.ts:83`, plus the caller in `meetings.ts`.

### Item 8 — Login rate limit keyed on email · **2 h** · Priority: **Medium**

Login is 5/15 min and signup 3/hour, IP-keyed. Behind carrier-grade NAT, thousands
of mobile users share an apparent IP, so a legitimate user can be locked out by
strangers on the same carrier. This is a mobile-specific failure that does not show
up in web testing.

**Design:** key on `hash(email) + IP` rather than IP alone, keeping a much higher
pure-IP ceiling as a DoS backstop.

**File:** `src/server/api/middleware/rate-limit.ts`

**Constraint:** must not weaken the anti-enumeration property. The response for a
rate-limited unknown email must be identical to that for a rate-limited known one.

### Item 9 — Echo `X-Request-Id` · **1 h** · Priority: **Low-Medium**

The app generates a request id per call (§6.6). If the API echoes it into its own
structured logs, a user-reported error becomes directly greppable in Railway logs.

**Files:** `src/server/api/middleware/request-id.ts` — accept an inbound
`x-request-id` (validate as a uuid; generate if absent or malformed) and echo it in
the response.

### Item 10 — Push notifications · **8–12 h** · Priority: **Deferred to 1.1**

The natural mobile feature: notify when processing completes. Requires APNs
credentials, a `device_tokens` table and migration, a worker hook, and Expo Push
integration. **Explicitly out of 1.0 scope.** The app polls status while foregrounded
and posts a *local* notification on upload completion, which covers the common case
without any backend work.

### Summary

| # | Change | Effort | Priority | Blocks 1.0? |
|---|---|---|---|---|
| 4 | `POST /auth/refresh` | 3 h | **Highest** | No, but strongly recommended |
| 3 | `/health` environment marker | 15 min | High | No |
| 2 | Web handoff token | 4 h | High | Degrades scope if absent |
| 6 | Re-presign existing meeting (+ orphan cleanup) | 2 h (+1 h) | Med-High | No |
| 1 | MIME enum extension | 30 min | Medium | No (recording works today) |
| 5 | Client version gate | 1 h | Medium | No |
| 7 | Longer signed read TTL | 1 h | Medium | **Yes — playback breaks without it** |
| 8 | Email-keyed login rate limit | 2 h | Medium | No |
| 9 | Echo `X-Request-Id` | 1 h | Low-Med | No |
| 10 | Push notifications | 8–12 h | Deferred | No |
| | **Total excluding item 10** | **~16 h** | | |

Item 7 is the only true blocker, and it is a one-line change.

---

## 18. Risks & open technical questions

### 18.1 Risk register

| # | Risk | Likelihood | Impact | Mitigation | Owner decision needed |
|---|---|---|---|---|---|
| R1 | **Streaming silently returns empty** if `fetchImpl` is ever RN's global fetch | Med | **Critical** — chat and search appear broken with no error | `stream_unsupported` hard throw (§6.7); unit test; day-one device verification | No |
| R2 | **`content-length` signature mismatch** → every upload 403s | Low | **Critical** | Measure once (§8.1); pre-PUT drift guard; Sentry alert; CI test that a short PUT is rejected | No |
| R3 | **Truncated `.m4a` unrecoverable** after force-quit | Med | High — user loses a whole meeting | §7.4 recovery; **verify empirically in week one**; fallback is 5-min segmentation (significant extra work) | **Yes — resolve before committing to the record UX** |
| R4 | **`expo-share-intent` breaks** on an SDK bump | Med | Medium — share-sheet import lost | Pin the version; keep `expo-document-picker` (first-party) as the always-working path | No |
| R5 | **Duplicate React** via `packages/shared` resolving up to the repo root | Med | High — "Invalid hook call," hard to diagnose | `disableHierarchicalLookup` + explicit `nodeModulesPaths` (§2.5); `require.resolve` smoke test (§14.2) | No |
| R6 | **Weekly forced logout** (no refresh endpoint) | **High** | High — churn and support load | §17 item 4 (3 h). Interim: T−24h banner (§5.6) | **Yes — build item 4 or accept** |
| R7 | **Presign expiry** on a large slow upload | Med | Medium — full re-upload | §17 item 6 | Yes — build or warn |
| R8 | **Background upload throttled** by iOS discretionary scheduling | Med | Medium — uploads land late | Set `isDiscretionary: false` where the API allows; foreground resume; honest UI | No |
| R9 | **`UIBackgroundModes: audio` rejected** at App Review | Low-Med | High — ship blocked | Visible recording indicator; explicit review notes; demo video | No |
| R10 | **Zod 3 vs 4 divergence** if either side upgrades alone | Low | Medium — shared schema fork | Pinned to 3.x (§4.2); CI typechecks shared against both consumers | No |
| R11 | **No staging backend** — TestFlight hits production | **High** | Medium — real quota, real cost, real data | Dedicated test account with raised quota; §12.1 records it as a decision | **Yes — accept or fund a staging env** |
| R12 | **Signed audio URL expires** in cache (600 s) | **High** | Medium — silent playback failure | §9.4 separate short-lived query + §17 item 7 | No — build item 7 |
| R13 | **RN New Architecture** incompatibility in a dependency | Low | High | Every dependency in §4 is Expo SDK 57-aligned and New-Arch ready; verify on first dev build | No |
| R14 | **Sentry trace correlation** fails across `expo/fetch` → Hono | Med | Low | Fall back to `X-Request-Id` (§17 item 9) | No |
| R15 | **Carrier NAT triggers login rate limits** | Med | Medium — legitimate users locked out | §17 item 8 | No |

### 18.2 Open technical questions

Each must be answered by experiment, not by argument. Ordered by how much design
depends on the answer.

| Q | Question | How to settle it | Blocks |
|---|---|---|---|
| **Q1** | Is `content-type` genuinely unsigned in the R2 presigned URL? `r2.ts:69-79` passes it to `PutObjectCommand`; the audit says it does not reach `SignedHeaders`. | Presign a URL; PUT with a deliberately wrong `Content-Type`; observe 200 vs 403. | §8 header construction. **Week one.** |
| **Q2** | Does `expo-audio`'s iOS writer leave a playable file after a force-quit? | Record 60 s, force-quit, inspect: does it play? Is the duration right? | §7.4 recovery vs. segmentation. **Week one — this can change the record architecture.** |
| **Q3** | Does chunked transfer from Hono survive Railway's proxy without buffering? | Stream a chat response from a device; assert >1 chunk with measurable inter-chunk time. | §6.7. If it buffers, streaming UX is a lie regardless of client. **Week one.** |
| **Q4** | Does `disableHierarchicalLookup` + `nodeModulesPaths` reliably prevent the duplicate-React failure with a `watchFolder` under the repo root? | `require.resolve('react')` assertion on device (§14.2). | §2 layout. **Day one.** |
| **Q5** | Is `atob` present in the Hermes build shipped with SDK 57? | Smoke test (§14.2). Fallback: `expo-crypto` base64. | §5.5 |
| **Q6** | Does `expo-file-system`'s background `sessionType` survive a **user** force-quit, or only a system kill? Apple's semantics differ between the two. | Upload 200 MB throttled, force-quit at ~50%, relaunch, observe. | §8.6 recovery design |
| **Q7** | Does AssemblyAI accept raw CAF, if item 1 adds `audio/x-caf`? | Submit a CAF fixture through the real pipeline. | §17 item 1. Do **before** widening the enum. |
| **Q8** | Does 64 kbps mono degrade transcription WER measurably? | Transcribe three real meetings at 64 and 128 kbps; compare. | §7.2 bitrate. Cheap to revert. |
| **Q9** | Do Sentry distributed traces propagate `expo/fetch` → Hono? | One instrumented request; check the Sentry trace view. | §11.2. Fallback exists. |
| **Q10** | Does the existing web SSR path ever call `apiRequest`? The factory migration removes the `typeof window` guard. | Grep during the §3.3 migration PR; typecheck + build. | §3.4 migration safety |

### 18.3 Product decisions needed before implementation starts

Engineering cannot resolve these unilaterally:

1. **Build `POST /auth/refresh` (3 h) or accept weekly forced logouts?** (R6) —
   Recommendation: build it. It is the cheapest high-impact item in §17.
2. **Fund a staging backend, or point TestFlight at production?** (R11) —
   Recommendation: accept production with a dedicated test account for 1.0; revisit
   before any public beta.
3. **If Q2 shows unrecoverable truncation, accept the risk or fund segmented
   recording (~2 days)?** — Recommendation: fund it. Losing a 90-minute meeting is
   the worst thing this app can do to a user, and it is the failure they will tell
   other people about.
4. **Confirm iPhone-only, portrait-only for 1.0** — `supportsTablet: false` and
   portrait lock are assumed throughout §16's budgets. Changing this later means
   revisiting every layout.

---

## Appendix A — Version reference

Resolved from `registry.npmjs.org/<pkg>/latest` on **2026-08-12**.

| Package | Version | Source |
|---|---|---|
| expo | 57.0.12 | https://www.npmjs.com/package/expo |
| react-native | 0.87.0 | https://www.npmjs.com/package/react-native |
| expo-router | 57.0.12 | https://www.npmjs.com/package/expo-router |
| expo-audio | 57.0.3 | https://www.npmjs.com/package/expo-audio |
| expo-av (superseded) | 16.0.8 | https://www.npmjs.com/package/expo-av |
| expo-file-system | 57.0.2 | https://www.npmjs.com/package/expo-file-system |
| expo-secure-store | 57.0.1 | https://www.npmjs.com/package/expo-secure-store |
| expo-document-picker | 57.0.1 | https://www.npmjs.com/package/expo-document-picker |
| expo-share-intent | 8.0.1 | https://www.npmjs.com/package/expo-share-intent |
| expo-crypto | 57.0.1 | https://www.npmjs.com/package/expo-crypto |
| expo-constants | 57.0.10 | https://www.npmjs.com/package/expo-constants |
| expo-linking | 57.0.5 | https://www.npmjs.com/package/expo-linking |
| expo-haptics | 57.0.1 | https://www.npmjs.com/package/expo-haptics |
| expo-dev-client | 57.0.11 | https://www.npmjs.com/package/expo-dev-client |
| expo-build-properties | 57.0.10 | https://www.npmjs.com/package/expo-build-properties |
| @tanstack/react-query | 5.101.4 | https://www.npmjs.com/package/@tanstack/react-query |
| @tanstack/react-query-persist-client | 5.101.4 | https://www.npmjs.com/package/@tanstack/react-query-persist-client |
| @tanstack/query-async-storage-persister | 5.101.4 | https://www.npmjs.com/package/@tanstack/query-async-storage-persister |
| @react-native-async-storage/async-storage | 3.1.1 | https://www.npmjs.com/package/@react-native-async-storage/async-storage |
| zustand | 5.0.14 | https://www.npmjs.com/package/zustand |
| react-native-reanimated | 4.5.3 | https://www.npmjs.com/package/react-native-reanimated |
| react-native-gesture-handler | 3.1.0 | https://www.npmjs.com/package/react-native-gesture-handler |
| react-native-screens | 4.27.0 | https://www.npmjs.com/package/react-native-screens |
| react-native-safe-area-context | 5.8.1 | https://www.npmjs.com/package/react-native-safe-area-context |
| @sentry/react-native | 8.22.0 | https://www.npmjs.com/package/@sentry/react-native |
| jest-expo | 57.0.4 | https://www.npmjs.com/package/jest-expo |
| @testing-library/react-native | 14.0.1 | https://www.npmjs.com/package/@testing-library/react-native |
| eas-cli | 21.8.0 | https://www.npmjs.com/package/eas-cli |
| zod (pinned to match server) | ^3.24.2 (latest is 4.4.3) | https://www.npmjs.com/package/zod |

**Documentation sources:**

- [Expo Audio (SDK 57)](https://docs.expo.dev/versions/latest/sdk/audio/) — `expo-audio` as current module, `HIGH_QUALITY` → `.m4a` / MPEG4AAC, `enableBackgroundRecording`, `setAudioModeAsync`
- [`expo/fetch`](https://docs.expo.dev/versions/latest/sdk/expo/) — WinterCG Fetch with `ReadableStream` body support, works in Expo Go, UTF-8-only `TextDecoder`
- [Expo FileSystem (SDK 57)](https://docs.expo.dev/versions/latest/sdk/filesystem/) — `File`/`Directory`/`Paths`, `createUploadTask`, `UploadType.BINARY_CONTENT`, `sessionType: 'background'`
- [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/) — Keychain accessibility constants, sync vs async reads, size limits
- [Expo monorepos](https://docs.expo.dev/guides/monorepos/) — automatic Metro config since SDK 52, duplicate-React prohibition, autolinking dedup in SDK 55
- [Expo Apple privacy manifests](https://docs.expo.dev/guides/apple-privacy/) — `ios.privacyManifests`, per-module `PrivacyInfo.xcprivacy` discovery
- [Sentry with Expo](https://docs.expo.dev/guides/using-sentry/) — wizard setup, EAS source-map upload

---

## Appendix B — Code audit references

| Fact | Location |
|---|---|
| Accepted MIME enum (closed; no `audio/aac`, no `audio/x-caf`) | `src/lib/schemas.ts:29-39` |
| Upload request: 500 MB cap, 4 h duration cap | `src/lib/schemas.ts:88-114` |
| Presign signs both `ContentType` and `ContentLength` | `src/server/services/r2.ts:69-79` |
| MIME → file extension map | `src/server/services/r2.ts:52-66` |
| Signed read URL default TTL: 600 s | `src/server/services/r2.ts:83` |
| `/upload-url` inserts a meetings row before presigning | `src/server/api/routes/meetings.ts:61-91` |
| 403 stale-workspace self-heal | `src/lib/api/client.ts:137-149` |
| 401 handling via `window.dispatchEvent` | `src/lib/api/client.ts:157-165` |
| `apiStream` silently returns on a falsy body | `src/lib/api/client.ts:206` |
| `x-citations` header (URI-encoded JSON) | `src/server/api/routes/search.ts:82,114` |
| `/health` payload lacks an environment marker | `src/server/api/routes/health.ts:26-32` |
| Existing CI workflows | `.github/workflows/ci-{backend,frontend,responsible-ai}.yml` |
