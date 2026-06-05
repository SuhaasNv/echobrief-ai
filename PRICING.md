# EchoBrief — Pricing Strategy (working doc)

> Living doc. Iterate freely. Last updated 2026-05-17.

## TL;DR — the recommendation

**Ship 4 tiers**, but in sequence:

| Tier        | Price (annual)         | Price (monthly) | Who it's for                                 |
| ----------- | ---------------------- | --------------- | -------------------------------------------- |
| **Free**    | $0                     | $0              | Try-before-buy, single workspace             |
| **Student** | $7 /mo ($84/yr)        | $10 /mo         | Verified .edu, learning-focused              |
| **Pro**     | $14 /mo ($168/yr)      | $19 /mo         | Solo working professionals, mixed-mode users |
| **Team**    | $29 /user/mo ($348/yr) | $39 /user/mo    | 5+ seats, shared workspaces                  |

Plus an off-menu **Enterprise** tier (talk to sales) for SSO/SCIM/data-residency at $5K+/yr.

### Shipping order

1. **v1 → Free + Pro only**, Stripe, monthly + annual. Validate that anyone pays.
2. **v2 → Add Student** with simple `.edu` domain check (SheerID later).
3. **v3 → Add Team** when multi-user workspace membership is built.

Don't ship 4 tiers on day one. Too much surface to maintain conversion data for; not enough volume yet.

---

## Market context (May 2026)

| Competitor            | Free                                    | Pro (annual)              | Team           | Student                      |
| --------------------- | --------------------------------------- | ------------------------- | -------------- | ---------------------------- |
| Otter                 | 300 min/mo, 30-min cap                  | $8.33/mo                  | $20/user/mo    | 20% off Pro for .edu         |
| Fathom                | unlimited recordings, 5 AI summaries/mo | $15/mo                    | $29–39/user/mo | —                            |
| Fireflies             | 800 min/mo                              | $19.75/mo                 | $29.75/user/mo | —                            |
| tl;dv                 | unlimited recordings                    | $18/mo                    | $59/user/mo    | —                            |
| Granola               | 25 meetings                             | $14–18/mo                 | $29/user/mo    | —                            |
| Perplexity (adjacent) | (search free)                           | $20/mo                    | —              | $10/mo via SheerID (50% off) |
| NotebookLM            | free, 1-mo Gemini Pro trial             | (in Google AI Pro $20/mo) | —              | 12-mo trial of Google AI Pro |

### Patterns

1. **Be generous with capture, ration AI.** Free users get recording; AI summaries/queries are the conversion gate.
2. **Pro is $12–19/month annual.** $14–15 is the modern sweet spot.
3. **Team is $25–35/user/mo annual.** Above $40 hits resistance for <50-person companies.
4. **Student ≈ 50% off with verification.** Perplexity ($10 vs $20) is the emerging model; Otter's 20% looks stingy in comparison.
5. **Nobody is good at students.** Perplexity Study Mode (flashcards + quizzes) is the only adjacent feature. EchoBrief's student fork + flashcards is genuinely differentiated here.

---

## Feature matrix

| Feature                                  |     Free      |            Student            |            Pro            |           Team            |
| ---------------------------------------- | :-----------: | :---------------------------: | :-----------------------: | :-----------------------: |
| Workspaces                               |       1       | unlimited (student kind only) |   unlimited (any kind)    |    unlimited (shared)     |
| Transcription quota                      |   5 hrs/mo    |           unlimited           |         unlimited         |         unlimited         |
| AI summaries                             |       ✓       |               ✓               |             ✓             |             ✓             |
| Per-meeting AI chat                      | 10 queries/mo |           unlimited           |         unlimited         |         unlimited         |
| Cross-meeting search                     |       ✗       |               ✓               |             ✓             |             ✓             |
| Flashcards                               |   3/lecture   |           unlimited           | unlimited (in student WS) | unlimited (in student WS) |
| Study mode                               |       ✗       |               ✓               |     ✓ (in student WS)     |     ✓ (in student WS)     |
| Speaker analytics                        |     basic     |             basic             |           full            |           full            |
| Action item exports (Linear/Notion/Jira) |       ✗       |               ✗               |             ✓             |             ✓             |
| Email generator                          |       ✗       |               ✗               |             ✓             |             ✓             |
| Integrations                             |       ✗       |               ✗               |             ✓             |             ✓             |
| History retention                        |    30 days    |            1 year             |          2 years          |         unlimited         |
| Multi-user shared workspaces             |       ✗       |               ✗               |             ✗             |             ✓             |
| Workspace analytics                      |       ✗       |               ✗               |             ✓             |        team-level         |
| Priority processing                      |       ✗       |               ✗               |             ✓             |             ✓             |
| SSO + SCIM + audit logs                  |       ✗       |               ✗               |             ✗             |     Enterprise add-on     |

### Why this structure

1. **Free is honest and limited.** 5 hrs/mo + 10 AI queries is enough to fall in love, but you'll hit it within 2 weeks of active use. Comparable to Otter's 300 min/mo.
2. **Student is unmissable value.** Half the price of Pro; the killer student feature (flashcards + study mode) is unavailable to Pro users unless they create a student workspace. The .edu wall keeps it self-selecting.
3. **Pro is for solo working pros and mixed users.** A grad student who also interns can run "Coursework" + "Internship" workspaces side-by-side — both with appropriate features.
4. **Team gates on shared workspaces.** Multi-user membership is not built yet (workspaces are single-owner). When it lands, that's Team's wedge. Until then, sell Pro at ~$14 to anyone using EchoBrief for work.
5. **Enterprise lives off-menu.** SSO, SCIM, data residency, custom MSA — these are "talk to sales" prices. Don't crowd the public pricing page.

---

## Workspace ↔ tier mapping (this is the elegant bit)

Since workspaces already exist and have a `kind`, tier enforcement is just two questions: _can this user have another workspace?_ and _can this user use this feature inside this workspace?_

| Tier        | Workspace rules                                                                                                                                                              |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Free**    | Exactly 1 workspace, type chosen at signup. Trying to create a 2nd → upgrade modal.                                                                                          |
| **Student** | Unlimited workspaces, **all must be `kind: 'student'`**. Trying to create `professional` → "Looks like you've got real work going on — upgrade to Pro for mixed workspaces." |
| **Pro**     | Unlimited workspaces of any kind. Each `professional` workspace gets full pro features; each `student` workspace gets flashcards. No friction.                               |
| **Team**    | Same as Pro + workspaces become invitable. Billing per active member across all team workspaces.                                                                             |

The conversion mechanic: every time someone hits the boundary of their tier, that's a paywall moment. With workspaces as the boundary, it's natural — not "feature creep."

---

## Upgrade prompts (where revenue actually happens)

Ranked by typical conversion:

### 1. Hard gates at action time (highest)

The user is mid-flow. Show the upgrade for the exact thing.

- Free user clicks "Generate flashcards" beyond limit → **"Unlimited flashcards on Student ($7) or Pro."**
- Student clicks Integrations → **"Integrations are a Pro feature."**
- Free user creates 2nd workspace → **"Multiple workspaces are on Pro."**
- Free user, 11th AI query of month → **"You've used your 10 free queries. Upgrade for unlimited."**

### 2. Soft nudges at quota awareness (medium)

- Banner on /app when transcription quota crosses 80%: **"4 of 5 hours used this month."** Dismissible.
- After uploading a 90-minute lecture: **"This one took 60% of your monthly cap."**

### 3. Empty state on locked surfaces (low but free)

- /app/analytics for a Free user → not a 404, a beautiful "Analytics is a Pro feature" pitch with a chart screenshot.
- /app/integrations same treatment.

### 4. Lifecycle moments (drip)

- End of week 1 email: _"You've added 12 lectures in your first week. Pro keeps everything for 2 years instead of 30 days."_
- End of month 1 email: _"Here's what Pro would unlock."_
- After action-item completion streak: _"You're using this enough to justify Pro."_

### 5. Settings → Billing (passive but trusted)

Always-on comparison table. People price-shop here before deciding.

---

## Copy patterns that convert

**Don't write**: "Upgrade to Pro for advanced features."
**Do write**: "You've recorded 4.2 hours this month. Pro gives you unlimited."

**Don't write**: "Get more from EchoBrief with Pro."
**Do write**: "Linear export turns every action item into a ticket automatically. That's on Pro."

**Don't write**: "Student pricing available."
**Do write**: "Are you a student? Get Pro for $7/mo with your .edu email. Same features, half the price."

The pattern: **name the specific thing they just tried, name the price.** No "discover" or "unlock" verbs.

---

## Annual vs monthly anchoring

Show the annual price as the headline with the monthly equivalent in the corner. Display strikethrough on the monthly when annual is selected. ~30% discount for annual commit is industry standard.

```
PRO
$14 /month
$168 billed annually  ·  $19 if billed monthly
[Choose Pro]
```

This is exactly what Otter, Fathom, Granola all do.

---

## What needs to be built before any of this ships

None of this exists yet. Phases:

1. **Usage tracking** — `usage_log` table tracking minutes transcribed + AI queries per workspace per month. Cron job rolls it up nightly. **Foundation for everything else.**
2. **Tier model** — `subscriptions` table linking user → tier + Stripe customer ID + renewal date.
3. **Stripe checkout + webhooks** — `/billing` page with Stripe Checkout Session; webhook updates subscriptions table.
4. **Feature flag hooks** — `useFeatureAccess('flashcards')`, `useUsage('transcription_minutes')`. Frontend asks these before rendering UI.
5. **Upgrade modal** — one reusable component, called from every gate, prefilled with which feature triggered it (for analytics).
6. **`.edu` verification** — start with simple `@*.edu` domain check, graduate to SheerID when revenue justifies the $0.50/verification fee.
7. **Pricing page rebuild** — current `/` has placeholder pricing cards; replace with real ones tied to Stripe.

---

## Risks and open questions

- **Do we want a free trial of Pro for everyone?** Could be 14 days with full Pro. Some teams convert better with "always free" tier; others with "trial that expires." Probably ship without trial and add later if needed.
- **Yearly commit lock-in.** Prorated refund for cancellations? Industry default: no refund, but easy downgrade at renewal.
- **What about students who graduate?** When .edu email stops working, do we drop them to Free or grandfather them on Student? Otter grandfathers; sensible model.
- **Team minimum seats.** Is it 5 (to push small teams to Pro x N) or 2 (lower barrier)? Start at 5; lower if conversion data warrants.
- **Pro seat for someone using EchoBrief mostly for school.** Should they have to pay Pro because they need a `professional` workspace for one side project? Maybe a "Pro + Student" combo tier — but probably overcomplicates. Punt for now.
- **Storage costs at unlimited tier.** A 90-min lecture is ~80MB on R2. At unlimited storage, heavy users could cost $5+/mo in storage alone. Cap audio retention at 2 years on Pro (already in plan); think about per-user storage caps later.

---

## Decision log (record changes here)

- **2026-05-17** — Initial doc. Recommend Free + Pro launch, Student/Team to follow. Workspace-level kind already shipped, so tier mapping is straightforward.
