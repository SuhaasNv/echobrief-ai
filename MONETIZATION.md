# Monetization & Paywall Design

Operator context: solo founder, based in **Singapore**, running this alongside other
work. Selling worldwide. Every number below is derived from this repo — the
per-minute and per-token rates are the ones the code actually bills against, not
estimates. Where something is a judgement call rather than a measurement, it says so.

Supersedes the tier prices in `PRICING.md`. See [§9](#9-what-has-to-change-in-the-code) for what that
means for the files that currently disagree.

---

## 1. The honest starting position

**There is no payment path today.** Not a weak one — none.

| | State | Evidence |
|---|---|---|
| Payment provider | none installed | no stripe / revenuecat / expo-in-app-purchases in any `package.json` |
| `POST /subscription/upgrade` | stub | `src/server/api/routes/subscription.ts:191` returns `"Stripe integration pending"` |
| Web upgrade button | native `alert()` | `src/components/upgrade-modal.tsx:39` |
| Mobile Plan screen | dead end | points at a web billing flow that does not exist |
| Tier changes | admin-only | `PATCH /admin/users/:id/subscription`, or raw SQL |

Quota **enforcement** is real (server-side 429s from `middleware/quota.ts`), and the
usage meters on the Plan screen are the best-built component in the app. The plumbing
that is missing is purely the part that takes money.

---

## 2. Unit economics

Marginal cost per unit of use, from the rates in the code:

| Input | Rate | Source |
|---|---|---|
| Transcription | $0.0035 / min | `services/assemblyai.ts` |
| Analysis (GPT-5) | $1.25 / $10 per 1M tok | `services/llm.ts` `MODEL_PRICING_USD_PER_1M` |
| Embeddings | text-embedding-3-small | negligible at this scale |
| Storage | $0.015 / GB-month | R2, and default retention is 7 days |

**Per recorded hour**

```
transcription   60 min x $0.0035          = $0.210
analysis        ~12k in + ~2k out          = $0.035
embeddings + storage (7-day retention)     < $0.010
                                            ───────
                                             ~$0.25
```

**Per Ask question**

```
~8k in x $1.25/1M    = $0.010
~500 out x $10/1M    = $0.005
                       ───────
                        ~$0.015
```

The headline: **questions are ~17x cheaper than recorded hours.** That single ratio
should drive the whole tier design, and today it drives none of it — the free tier is
generous on the expensive thing (300 min) and stingy on the cheap one (10 questions).

---

## 3. Pricing

### The recommendation

**US$9 / month, or US$72 / year (US$6/mo effective).** One paid tier.

That is roughly **half of Otter Pro (~$17)** and **half of Granola (~$18)**, which
gives a one-sentence position: *half the price of Otter, built for the meetings Otter
cannot hear.*

### Why not cheaper

COGS is not the constraint. At $5/month the margin still works. The constraint is that
**the scarce resources are users acquired and operator hours**, and both scale with
headcount rather than price.

To clear ~US$1,500/month:

| Price | Paying users needed |
|---|---|
| $19 | ~94 |
| $9 | ~208 |
| $5 | ~400 |

Halving the price roughly doubles the humans to find, support, refund and answer App
Store reviews for — for identical revenue. For a solo operator that is the thing that
ends the project, not the gross margin.

Under-pricing is also not pro-user. An app that stops being maintained in eight months
takes its users' meeting history with it. Price for sustainability plus enough margin
to fund improvement.

### Why not compete on price at all

**Otter's free tier is 300 min/month. You cannot go below free.** Competing on price
against a VC-funded incumbent's loss-leader is unwinnable; they can sustain zero longer
than you can.

The competitive advantage is fit, not cost:

- **In-person capture.** Otter joins Zoom calls; Granola takes Mac system audio. This
  app is mic-first, which is a weakness on video calls and the entire point for a
  conversation happening in a room.
- **Live Activity.** Pause and stop from the Dynamic Island. Otter's iOS app does not
  do this.
- **Ribbon-as-scrubber.** The diarization map *is* the seek bar, so you can see who is
  speaking at any playhead position without reading. An independent design review
  called this "better than anything Otter ships".

### Margin check

| Price | Net after Apple 15% | Typical user (4h + 30 q) | Margin | User at cap (15h + 200 q) |
|---|---|---|---|---|
| $9/mo | $7.65 | $1.45 | **81%** | 48% |
| $72/yr | $61.20 ($5.10/mo) | $1.45 | **72%** | 22% |

The cap is what protects the tail; the average is what pays. Annual is intentionally
thinner — it buys cash up front and lower churn, both of which matter more than points
of margin for a side project.

### Regional pricing — the actual "beat everyone" lever

Apple supports per-territory prices and handles currency and tax itself. Otter and
Granola largely do not localise price. That is a real gap, and it is largest in the
home market.

| Territory | Monthly | Annual |
|---|---|---|
| Singapore | S$12.98 | S$98 |
| US / EU / UK / AU / CA | $9 | $72 |
| India, Indonesia, Philippines, Vietnam, Thailand | $3–4 equiv | $29–39 equiv |
| Rest of world | Apple's auto-converted equivalent | — |

Undercut hard where willingness-to-pay is genuinely lower; hold price in the markets
that fund development.

### Two things not to do

- **No lifetime deal.** Recurring COGS against one-time revenue is how indie apps die.
  Every lifetime user is a permanent liability against a fixed payment.
- **Do not launch below $7.** A launch discount can always be run. Raising a price on
  existing subscribers is painful and public.

---

## 4. Payments: multi-country from Singapore

Selling digital goods creates tax obligations in the **buyer's** jurisdiction — EU VAT,
UK VAT, Australian GST, and roughly a hundred others. Registering and remitting in each
is a full-time job. So do not be the merchant.

**Use Apple IAP via RevenueCat.**

- Apple is Merchant of Record: they collect, remit VAT/GST worldwide, handle refunds,
  chargebacks and currency.
- **15%** under the Small Business Program (under $1M/yr).
- RevenueCat wraps StoreKit — receipt validation, entitlements, cross-device restore —
  and is free under ~$2.5k/mo revenue.
- Tax admin outside Singapore: **zero**.

This is also not optional. An iOS app selling digital content consumed in the app must
use IAP. The current Plan screen defers to "your account on the web", which is a
legitimate way to avoid Apple's cut — except **that web billing flow does not exist**,
so today it is a dead end pointing at nothing.

**Web billing:** only if and when web demand is proven. Then a Merchant of Record —
Paddle or Lemon Squeezy, ~5% — for the same reason. Not Stripe direct: Stripe Tax
calculates but does not remit, so the obligation stays with you.

**Singapore:** GST registration is compulsory above **S$1M** annual turnover, so a side
project is almost certainly below the threshold. Income remains assessable. *Confirm
with an accountant — this is the one item here that is not a verified fact about the
codebase.*

---

## 5. What is free and what is paid

Principle: **meter what costs money, give away what creates the habit, charge for what
signals professional use.**

| | Free | Pro |
|---|---|---|
| Recording + transcription | **120 min / mo** | **15 hrs / mo** |
| Per-recording length cap | **30 min** | 4 hrs |
| Ask questions | **25 / mo** | effectively unlimited (fair-use 500) |
| Audio retention | 7 days | up to 1 year, user's choice |
| Custom vocabulary | — | ✓ |
| Speaker names | — | ✓ |
| Profanity filter | ✓ | ✓ |
| Live Activity / Dynamic Island | ✓ | ✓ |
| Share links | ✓ | ✓ |
| Export (copy / share sheet) | ✓ | ✓ |
| Full-text + semantic search | ✓ | ✓ |
| Summaries, action items, chapters | ✓ | ✓ |

### The reasoning behind each non-obvious line

**Free drops from 300 → 120 min, and gains a 30-min per-recording cap.**
300 min/month *fully serves the target user*: a property agent doing ten 20-minute
client meetings uses 200 minutes and never pays. The per-recording cap matters more
than the monthly total — it is what separates "evaluating this" from "running my
business on this", and it is the honest version of a limit because it is visible before
you press record rather than discovered mid-meeting.

**Ask rises from 10 → 25.**
10/month is the single worst number in the current pricing. Ask is the only real
differentiator, questions cost ~$0.015, and users hit the wall after tapping three
starter prompts — before the habit exists. 25 free questions costs ~$0.38/user/month.
Cheap, and it buys the behaviour that is being monetised.

**Retention is the best paywall here, and it is already built.**
Free keeps audio 7 days; transcripts, summaries and action items stay forever. It is
honest (storage genuinely costs money), it maps to a real professional need —
compliance, a disputed conversation, a client calling back in March about a January
meeting — and the moment it bites is emotionally exact: *"the audio for this meeting
expires in 2 days."*

**Recording itself is never paywalled.**
If someone cannot capture, they lose the meeting permanently. Data loss as a business
model earns one-star reviews and is not recoverable.

**Share links stay free.**
They are the only viral surface in the product. A share link is a landing page with the
app's branding shown to someone who does not have it.

**Export stays free.**
Charging for the right to leave with your own data breeds resentment, and it is worth
almost nothing as a gate.

---

## 6. Paywall design

This codebase's whole ethos is not lying to users — four inert settings and a privacy
toggle that enforced nothing have already been found and fixed. The paywall has to hold
that line, which rules out most of what apps do here.

### Three rules

1. **No launch-time modal.** It appears where value has just been demonstrated, never
   before it.
2. **Warn before the wall.** `src/components/quota-banner.tsx` is a complete 80%
   threshold banner that is **imported by nothing**. Wire it. A limit that arrives as a
   surprise produces a cancellation; one that was flagged at 80% produces an upgrade.
3. **Show what they would lose, not what they would gain.** Their data, their numbers.

### Trigger moments, ranked by intent

1. **Retention expiry** — *"The audio for 3 meetings expires in 2 days."* Highest
   intent, because it is loss rather than aspiration.
2. **Ask cap** — immediately after an answer that was actually useful.
3. **Minutes cap** — **at press-record, never mid-recording.** Show remaining minutes
   before capture starts. Interrupting a live meeting to ask for money is the single
   worst thing this product could do.

### The sheet

Medium detent, not full screen.

```
  ────────────────────────────────
  Keep your recordings

  You've recorded 4h 20m across 11 meetings
  this month. On Free, audio is deleted after
  7 days — 3 recordings expire on Friday.

  Pro keeps audio as long as you choose, lifts
  Ask to unlimited, and raises recording to
  15 hours a month.

  ┌──────────────────────────────┐
  │     Upgrade — $9/month       │
  └──────────────────────────────┘
      or $6/month billed annually

              Not now
     Restore purchases · Terms · Privacy
  ────────────────────────────────
```

Deliberate choices:

- **Opens with the user's own usage.** It cannot read as a generic upsell because the
  numbers are theirs.
- **Names the loss with a date.** "Friday" converts; "keep your data longer" does not.
- **States the annual price as "$6/month billed annually"**, never a bare "$6/month".
  The current landing page shows "$14 /month" for what `PRICING.md` prices as the
  annual rate — that framing generates chargebacks and App Store rejections.
- **One primary action.** No tier comparison table at the moment of decision.
- **"Not now" actually dismisses.** No guilt copy, no delay before the button enables.
- **Restore purchases is present.** Apple requires it, and it is the first thing a
  returning user looks for.

### Screens that need work

**Plan screen** — currently a dead end that says plan changes are "handled on the web"
and provides no link. It becomes the primary upgrade surface: keep the usage meters,
add an Upgrade button beneath them.

**Remove the amber "Limit reached" on `Workspaces 1 of 1`.** Every free user sees a
warning-coloured bar for the normal default state, on the screen where money is being
asked for. Wrong first impression at the worst moment. (The limit is not enforced
anywhere either — `checkWorkspaceQuota()` has no production call site.)

**Fix the 429 copy.** `apps/mobile/src/lib/api/errors.ts:89` tells a quota-exhausted
user *"The server is rate limiting this account. Waiting a moment and trying again
usually clears it."* For a monthly cap that wait is up to 31 days. `components/ask/failure.tsx`
already handles this properly — it names the limit, gives the reset date, and correctly
omits a retry button. That treatment should be the default everywhere, and it should
classify on a machine-readable error code rather than by regex on the message string.

---

## 7. Ask scoping — a gap worth closing before charging for Ask

`POST /meetings/:id/chat` **already passes the entire transcript** — no chunking, no
retrieval — so a one-hour meeting (~12k tokens, ~$0.015/question) is fully in context.
It is wired on web (`src/routes/app.chat.tsx`) and **absent from the mobile app
entirely** (no `chat.ts` in `apps/mobile/src/lib/api/`).

So on mobile, Ask is cross-meeting only. A user who wants to interrogate one specific
meeting cannot.

Needed:

1. A **scope control** in the Ask composer — *All meetings* / *This meeting*.
2. An **"Ask about this meeting"** entry point on the meeting detail screen that opens
   Ask pre-scoped.
3. Route scoped questions to `/meetings/:id/chat` (whole transcript) and unscoped ones
   to `/search` (RAG).

This matters commercially: Ask is what Pro is being sold on, and "talk to this meeting"
is the more intuitive of the two modes.

---

## 8. Cost controls to land before launch

Verified issues that change the economics:

- **`ChatMessage.content` has no length cap** (`packages/shared/src/schemas.ts`). One
  request can push ~2.5M tokens at GPT-5. This is the cheapest way for anyone to run up
  the bill, and it makes per-question cost unpredictable. Cap it.
- **The quota pre-check never fires for failing uploads.** `requireTranscriptionQuota`
  only reads; the counter increments in `logTranscription`, which runs *after* a
  successful transcription. Reserve at admission, not only at completion.
- **`/streaming/*` charges 1 minute for a session of any length** — it reads
  `duration_sec` while the client sends `max_session_duration_seconds`.
- **`logTranscription` is only called on the AssemblyAI branch**, so `/from-live` and
  `/from-transcript` minutes are never counted.

(Already fixed this session: the segmented recording path — the one the mobile app
actually records through — had **no quota mounted at all**.)

---

## 9. What has to change in the code

Roughly in order.

1. **Pricing source of truth.** `PRICING.md` says $10/$19/$39 monthly and $7/$14/$29
   annual; the landing page (`src/routes/index.tsx`) renders "$14 /month" with no
   annual commitment disclosed. Both need to match this document, and the misleading
   monthly framing is a fix-before-launch regardless of final price.
2. **RevenueCat + StoreKit.** Products, entitlements, receipt validation, restore. A
   server webhook to write `subscriptions.tier` so the existing quota middleware — which
   already works — sees the change.
3. **Paywall sheet.** As specified in §6, triggered at the three moments.
4. **Wire `quota-banner.tsx`** at 80%.
5. **Plan screen upgrade path**, and delete the amber workspaces meter.
6. **Quota-aware error copy** in `errors.ts`, classified on a code rather than a regex.
7. **Ask scope control** and a mobile client for `/meetings/:id/chat` (§7).
8. **Cost controls** from §8.

Deliberately **not** on this list: teams and invites. `sendWorkspaceInvite()` exists
with zero callers, there is no invite endpoint, and every query is scoped by `user_id`
so a second member would see an empty library. A "Team" tier that cannot contain a team
should not be sold, and multi-user support is a support burden a side project does not
want.

---

## 10. Open questions

- **Free tier at 120 min — is that too tight for the ICP?** Worth instrumenting current
  usage distribution before committing, if any real users exist.
- **Is 15 hrs/mo the right Pro cap?** It is set by margin (81% at typical use), not by
  research. A heavy in-person user could exceed it.
- **Student pricing.** The schema already carries `account_kind: student | professional`
  and there is a flashcards feature behind it. An education tier is nearly free to offer
  and Otter charges students full price.
- **Trial vs freemium.** This document assumes freemium. A 7-day full-access trial may
  convert better for a product whose value is only obvious after a few real meetings.
