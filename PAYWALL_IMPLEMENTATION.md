# Paywall — Implementation Spec

Build specification for taking money. Companion to `MONETIZATION.md`, which holds the
pricing rationale; this document holds the decisions someone needs to actually write the
code without re-deriving them.

**Decided:** US$9/month, US$72/year. One paid tier (`pro`). Apple IAP via RevenueCat.

Nothing here is implemented yet. Every file path and column named below was verified
against the repo as of writing.

---

## 1. What already exists (do not rebuild)

This is the part that saves the most time. Quota enforcement is **already real**.

| Piece | Location | State |
|---|---|---|
| `subscriptions` table | `migrations/0008` | exists — `tier`, `status`, `billing_interval`, `current_period_start/end`, `price_usd` |
| `TIER_LIMITS` | `services/usage-tracker.ts:27` | exists — `free / student / pro / team` |
| Quota middleware | `api/middleware/quota.ts` | exists, mounted, returns real 429s |
| Usage meters UI | `app/(app)/account/plan.tsx` | exists — best-built component in the app |
| 80% banner | `components/quota-banner.tsx` | **written, imported by nothing** |
| Quota-aware failure UI | `components/ask/failure.tsx` | exists and is the quality bar to copy |
| `POST /subscription/upgrade` | `api/routes/subscription.ts:191` | **stub** — returns `"Stripe integration pending"` |

So the work is: a purchase flow, a server webhook that writes `subscriptions.tier`, a
paywall sheet, and honest copy. The enforcement layer underneath is done.

**Note the columns are Stripe-named** (`stripe_customer_id`, `stripe_subscription_id`).
Do not add RevenueCat-specific columns alongside them — see §4 for the migration.

---

## 2. Tier limits to change

`services/usage-tracker.ts:27`. Current vs target:

```diff
  free: {
-   transcription_minutes: 300,
+   transcription_minutes: 120,
-   ai_queries: 10,
+   ai_queries: 25,
    flashcards_per_lecture: 3,
    workspaces: 1,
  },
  pro: {
-   transcription_minutes: null,   // unlimited
+   transcription_minutes: 900,    // 15 hrs — a fair-use ceiling, not a product limit
-   ai_queries: null,
+   ai_queries: 500,
    flashcards_per_lecture: null,
    workspaces: null,
  },
```

Rationale in `MONETIZATION.md` §5. Two notes:

- **`null` means unlimited** in this table. Pro moving off `null` is a real behaviour
  change — it needs the same "you've hit your limit" path as free, with copy that says
  *fair use*, not *upgrade*. There is nothing to upgrade to.
- **A per-recording length cap (30 min free / 4 hr pro) does not exist anywhere** and is
  not expressible in `TIER_LIMITS`. It needs enforcing at `POST /meetings/segmented`
  (via `segment_target_seconds` × `total_segments`) and at `/meetings/upload-url` (via
  declared `duration_sec`). This is new work, not a config change.

---

## 3. App Store Connect

### Products

| Product ID | Type | Duration |
|---|---|---|
| `com.suhaasnv.echobrief.pro.monthly` | Auto-renewable subscription | 1 month |
| `com.suhaasnv.echobrief.pro.annual` | Auto-renewable subscription | 1 year |

Both in one Subscription Group (`EchoBrief Pro`) so a user can move between them and
Apple handles the proration. Annual at a **higher rank** in the group so an upgrade from
monthly is treated as an upgrade.

### Prices

Base tier US$9 / US$72. Then override per territory — this is the "beat everyone" lever
and Apple does the FX and tax:

| Territory | Monthly | Annual |
|---|---|---|
| Singapore | S$12.98 | S$98 |
| US / EU / UK / AU / CA / JP | $9 | $72 |
| India, Indonesia, Philippines, Vietnam, Thailand, Malaysia | ~$3–4 equiv | ~$29–39 equiv |
| Everywhere else | Apple auto-converted from base | — |

### Also required before review

- **Small Business Program enrolment** — 15% instead of 30%. Must be applied for; it is
  not automatic.
- Subscription **display name**, **description**, and a **review screenshot** per product.
- **Privacy Policy and Terms URLs** in App Store Connect *and* linked from the paywall
  sheet — Apple rejects paywalls without them.
- Paid Applications Agreement signed, banking and tax forms complete (Singapore entity
  or individual; W-8BEN for US tax treaty).

---

## 4. Data model

One migration. Keep the Stripe columns — they cost nothing and a web/MoR path may want
them later — and add a provider discriminator plus the Apple identifiers.

```
migrations/0022_iap_subscriptions.sql   (0020/0021 are taken by in-flight work)

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS rc_app_user_id TEXT,
  ADD COLUMN IF NOT EXISTS store_transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS store_product_id TEXT,
  ADD COLUMN IF NOT EXISTS auto_renew BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'production';

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_provider_check
  CHECK (provider IN ('none', 'apple', 'stripe'));

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_environment_check
  CHECK (environment IN ('production', 'sandbox'));

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_user_id_key
  ON public.subscriptions (user_id);
```

Decisions embedded there:

- **`provider` defaults to `'none'`**, not `'apple'`. An existing free row was not
  created by a purchase and must not claim to have been.
- **`environment` is stored.** Sandbox and production receipts both arrive at the same
  webhook. A sandbox purchase granting production Pro is the classic IAP mistake — the
  webhook must reject or flag mismatches rather than trust the payload.
- **`UNIQUE (user_id)`** because entitlement is per user, and the upsert in §6 depends
  on it. Verify no duplicates exist before adding it.
- **No `rc_entitlement` column.** Entitlement is derived from `tier` + `status` +
  `current_period_end`; a second source of truth would drift.

---

## 5. Client (mobile)

### Dependencies

`react-native-purchases` (RevenueCat). It is an autolinked native module, so **run
`expo run:ios` and confirm the build succeeds before writing any importing JS** — a
bundle importing a missing native module is an immediate red screen. (This is the same
sequencing the Google SSO work used for `expo-web-browser`.)

### Configuration

`EXPO_PUBLIC_REVENUECAT_IOS_KEY` — the RevenueCat **public** SDK key. Public by design;
it is safe in the bundle, unlike anything named `secret`. Note `EXPO_PUBLIC_*` is inlined
at build time.

### Identity

Call `Purchases.logIn(user.id)` on session adopt, `Purchases.logOut()` on sign-out. Using
the app's own user id as the RevenueCat App User ID is what makes restore work across
devices and what lets the webhook map a purchase to a row without a lookup table.

Wire it into the existing session paths — `adoptSession()` in `lib/api/auth.ts` and
`clearSession()` in `lib/api/token-store.ts` — so there is one place identity changes.

### New files

```
src/lib/api/purchases.ts        SDK init, logIn/logOut, offerings, purchase, restore
src/components/paywall/sheet.tsx        the sheet (§7)
src/components/paywall/use-paywall.ts   trigger state, presentation
```

### Entitlement state — the important part

**The server is the source of truth, not the SDK.** RevenueCat's `customerInfo` is a fast
local hint; `subscriptions.tier` is what the quota middleware actually enforces. If the
client trusts the SDK and the webhook has not landed yet, the UI says Pro while the API
returns 429 — the worst possible state.

So:

1. Purchase completes → SDK returns success.
2. Client shows a **brief "activating…"** state, not "You're Pro".
3. Client invalidates the subscription query and polls `GET /subscription` (existing
   route) until `tier === 'pro'`, with a bounded backoff (~10s).
4. On timeout: *"Your purchase went through. It can take a moment to activate — pull to
   refresh."* **Never** an error. The money left their account; the copy must not imply
   failure.

### Offline

Purchases require network. If offline when the sheet is opened, say so and disable the
button rather than failing at tap. `useOnline()` from `lib/api/errors.ts` already exists.

---

## 6. Server

### Webhook

```
POST /api/v1/webhooks/revenuecat        (public — mounted BEFORE requireAuth)
```

Requirements:

- **Verify the `Authorization` header** against `REVENUECAT_WEBHOOK_SECRET`. RevenueCat
  sends a shared secret you configure. A webhook that writes `tier` without verifying is
  a free-Pro endpoint for anyone who finds the URL.
- **Own rate-limit bucket**, fail-closed, keyed by IP. Do not put it under `general` —
  that is the one fail-open bucket in the system.
- **Idempotent.** Retries are normal. Key on the event id; ignore an event already
  applied. Also ignore an event **older** than the row's `updated_at` — events can
  arrive out of order and a stale `EXPIRATION` must not undo a fresh `RENEWAL`.
- **Reject environment mismatches.** A `SANDBOX` event must never grant production Pro.

Events to handle:

| Event | Effect |
|---|---|
| `INITIAL_PURCHASE`, `RENEWAL`, `UNCANCELLATION` | `tier='pro'`, `status='active'`, set `current_period_end`, `auto_renew=true` |
| `CANCELLATION` | `auto_renew=false`, **tier stays `pro`** until `current_period_end` |
| `EXPIRATION` | `tier='free'`, `status='expired'` |
| `BILLING_ISSUE` | `status='grace'`, **tier stays `pro`** for Apple's grace window |
| `REFUND` | `tier='free'`, `status='refunded'`, effective immediately |
| `PRODUCT_CHANGE` | update `store_product_id`, `billing_interval` |

**Cancellation must not revoke access.** The user paid through the end of the period.
Revoking at cancel time is theft and generates refund requests.

### Upsert

```sql
INSERT INTO subscriptions (user_id, tier, status, provider, environment, ...)
VALUES (...)
ON CONFLICT (user_id) DO UPDATE SET ...
```

Use the plain `${array}` form for any array parameters, **not `sql.array(...)`** — the
first execution of `= ANY(${sql.array(x)}::type[])` on a fresh connection fails to infer
its element type and serialises as a comma-joined string. Found and fixed in the cleanup
worker this session; do not reintroduce it.

### Retire the stub

`POST /subscription/upgrade` (`routes/subscription.ts:191`) currently returns
`"Stripe integration pending. Manual upgrade required."` and an integration test at
`tests/integration/subscription.test.ts:264` **asserts that string**, which makes the stub
load-bearing. Delete the route and the assertion together, or repoint the route at a
410 with an explanatory body. Do not leave it answering 200.

---

## 7. The paywall sheet

`src/components/paywall/sheet.tsx`. Medium detent. Never full-screen, never at launch.

### Props

```ts
interface PaywallSheetProps {
  trigger: "retention" | "ask_limit" | "minutes_limit" | "settings";
  /** Real usage, for the opening line. Never a generic claim. */
  usage: { minutesThisMonth: number; meetingCount: number; expiringSoon?: { count: number; onDate: string } };
  onDismiss: () => void;
}
```

### Layout

```
  ────────────────────────────────
  Keep your recordings                    ← 22pt semibold, --label

  You've recorded 4h 20m across 11         ← 15pt, --label-secondary
  meetings this month. On Free, audio is
  deleted after 7 days — 3 recordings
  expire on Friday.

  Pro keeps audio as long as you choose,   ← 15pt, --label-secondary
  lifts Ask to 500 questions a month, and
  raises recording to 15 hours.

  ┌──────────────────────────────┐         ← 50pt, bg-label, text-background
  │     Upgrade — $9/month       │            (the app's commit-button treatment)
  └──────────────────────────────┘
      or $6/month billed annually          ← 13pt --label-tertiary, TAPPABLE

              Not now                      ← 15pt --label-secondary
     Restore purchases · Terms · Privacy   ← 13pt --label-tertiary
  ────────────────────────────────
```

### Copy per trigger

| Trigger | Headline | Opening line |
|---|---|---|
| `retention` | Keep your recordings | *"…3 recordings expire on Friday."* |
| `ask_limit` | Ask more questions | *"You've asked 25 questions this month — your allowance resets on 1 September."* |
| `minutes_limit` | More recording time | *"You've recorded 2h 0m of your 2h this month."* |
| `settings` | EchoBrief Pro | *"You've recorded 4h 20m across 11 meetings this month."* |

### Non-negotiables

- **Prices come from RevenueCat offerings, never hardcoded.** They are localised per
  storefront; a hardcoded "$9" is wrong in every other currency and is an App Store
  rejection risk.
- **Annual is stated as "$6/month billed annually"**, never a bare "$6/month". The
  landing page currently shows "$14 /month" for what `PRICING.md` prices as an annual
  rate — fix that in the same change.
- **Restore purchases is required by Apple** and is the first thing a returning user
  looks for.
- **"Not now" dismisses immediately.** No delay before it enables, no guilt copy.
- **Colour:** the commit button uses the app's near-white pill (`bg-label` /
  `text-background`), matching the recorder's primary action. Do **not** invent a new
  accent. `--tint` means navigation in this app, not commit.

---

## 8. Triggers

| # | Where | Condition | Notes |
|---|---|---|---|
| 1 | Meeting list / detail | audio expiring within 3 days on ≥1 meeting | highest intent — loss, not aspiration |
| 2 | Ask, after an answer | `ai_queries` at limit | present *after* the answer renders, never instead of it |
| 3 | Record screen, **on press** | `transcription_minutes` at limit | **never mid-recording** |
| 4 | Plan screen | user-initiated | always available |

### The one hard rule

**Never interrupt a recording.** Check remaining minutes when the record button is
pressed and show remaining time *before* capture starts. A paywall that appears while a
real meeting is being recorded loses the meeting and the customer.

### Pre-warning

Wire `components/quota-banner.tsx` (written, currently imported by nothing) at **80%** on
the meetings list and the Ask tab. A limit flagged at 80% converts; a limit discovered at
100% cancels.

---

## 9. Copy to fix (not optional)

**`lib/api/errors.ts:89`** tells a quota-exhausted user:

> "The server is rate limiting this account. Waiting a moment and trying again usually
> clears it."

For a monthly cap that wait is **up to 31 days**. `components/ask/failure.tsx` already
does this correctly — names the limit, gives the reset date, omits the retry button. Make
that the default everywhere.

It should classify on a **machine-readable error code** from the server, not a regex over
the message string (`failure.tsx:46` currently regexes, so rewording the server message
silently downgrades it to a generic "Try again" card).

**Plan screen:** remove the amber *"Limit reached for this period"* on
`Workspaces 1 of 1`. Every free user sees a warning-coloured bar for the normal default
state on the screen where money is being asked for. The limit is not enforced anywhere
either — `checkWorkspaceQuota()` has no production call site.

---

## 10. Edge cases

| Case | Required behaviour |
|---|---|
| Restore on a new device | `Purchases.restorePurchases()` → webhook already has the row → server confirms |
| Refund | Immediate downgrade. Data is **not** deleted; retention reverts to 7 days going forward |
| Billing retry / grace | Keep Pro for Apple's grace window. Do not lock someone out over a card that expired |
| Cancel mid-period | Pro until `current_period_end`. Show the end date in the Plan screen |
| Family Sharing | Not enabled. Explicitly off in App Store Connect until it is thought through |
| Sandbox tester | `environment='sandbox'` — never grants production entitlement |
| Purchase, then webhook is slow | "Activating…" + poll. Never an error (§5) |
| Purchase while signed out | Not possible — the paywall is only reachable behind auth |
| User downgrades below current usage | Never delete data. Block *new* recording, keep everything already made |

---

## 11. Testing

- **StoreKit configuration file** in Xcode for local purchase testing without App Store
  Connect round-trips.
- **Sandbox tester account** for the full flow including restore and renewal (sandbox
  renews on an accelerated clock — monthly ≈ 5 minutes).
- **Webhook**: replay each of the seven event types, verify idempotency by sending the
  same event twice, verify out-of-order (send `EXPIRATION` dated before a `RENEWAL` and
  confirm it is ignored), and verify a sandbox event does not grant production Pro.
- **Quota integration**: with `tier='pro'`, confirm previously-429ing endpoints pass.
  Note `tests/integration/subscription.test.ts` exists and currently asserts the stub's
  string — it must be updated in the same change.
- **The paywall must never appear during an active recording.** Test explicitly.

---

## 12. Build order

Each step is independently shippable and leaves the app working.

1. **Tier limits + honest 429 copy + wire the quota banner.** No payments involved.
   Improves the product on its own and makes the limits real and legible.
2. **Migration 0022** + webhook endpoint + retire the `/subscription/upgrade` stub.
   Server-only; testable with replayed events before any client work.
3. **App Store Connect** products, prices, Small Business Program, agreements. Long lead
   time — start in parallel with 1 and 2.
4. **RevenueCat SDK** + `expo run:ios` native build + identity wiring. No UI yet.
5. **Paywall sheet** + the four triggers + Plan screen upgrade path.
6. **Per-recording length caps** (30 min free / 4 hr pro) — new enforcement, §2.
7. **Pricing page + `PRICING.md`** corrected to $9/$72 and the misleading monthly framing
   removed.

---

## 13. Deliberately out of scope

- **Teams / invites.** `sendWorkspaceInvite()` has zero callers, there is no invite
  endpoint, and every query is scoped by `user_id`, so a second member would see an empty
  library. A "Team" tier that cannot contain a team must not be sold.
- **Web billing.** Only once web demand is proven, and then through a Merchant of Record
  (Paddle / Lemon Squeezy) — never Stripe direct, which calculates tax but does not remit
  it.
- **Lifetime purchase.** Recurring COGS against one-time revenue.
- **Student tier.** The schema carries `account_kind` and there is a flashcards feature
  behind it, so it is cheap to add later — but it needs edu verification to not just be a
  discount code, and that is its own project.
