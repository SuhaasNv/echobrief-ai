# EchoBrief AI — User Screens Document

**Version:** 1.0  
**Author:** Suhaas NV  
**Last Updated:** 2026-05-14  
**Status:** Active

This document catalogs every screen in EchoBrief, its purpose, layout, states, and key interactions. Treat this as the source of truth for UI design and frontend implementation.

---

## Table of Contents

### Marketing / Auth
1. [Landing Page](#s-01-landing-page)
2. [Sign Up](#s-02-sign-up)
3. [Log In](#s-03-log-in)
4. [Forgot Password](#s-04-forgot-password)
5. [Email Verification](#s-05-email-verification)

### Core App
6. [Dashboard](#s-06-dashboard)
7. [Upload](#s-07-upload)
8. [Processing Status](#s-08-processing-status)
9. [Meetings List](#s-09-meetings-list)
10. [Meeting Detail](#s-10-meeting-detail)
11. [AI Chat (Cross-Meeting)](#s-11-ai-chat-cross-meeting)
12. [Action Items](#s-12-action-items)
13. [Shared Notes](#s-13-shared-notes)
14. [Analytics](#s-14-analytics)
15. [Settings](#s-15-settings)

### V2 Screens (Planned)
16. [Smart Timeline View](#s-16-smart-timeline-view)
17. [Meeting Score Detail](#s-17-meeting-score-detail)
18. [Integrations Hub](#s-18-integrations-hub)
19. [Email Generator](#s-19-email-generator)

### V3 Screens (Planned)
20. [Live Transcription](#s-20-live-transcription)
21. [Team Workspace](#s-21-team-workspace)
22. [Shared Meeting View](#s-22-shared-meeting-view)

---

## Screen Conventions

**Layout grid:** 12-column, max-width 1280px, centered. Sidebar is 240px fixed; content area is fluid.

**Breakpoints:**
- Mobile: 375px (single column, sidebar collapses to bottom nav)
- Tablet: 768px (sidebar becomes drawer, content full-width)
- Desktop: 1280px (full sidebar + content side-by-side)

**Status chips:**

| Status | Color | Label |
|--------|-------|-------|
| Queued | Gray | Queued |
| Transcribing | Blue (pulsing) | Transcribing... |
| Analyzing | Violet (pulsing) | Analyzing... |
| Indexing | Violet (pulsing) | Indexing... |
| Complete | Green | Ready |
| Failed | Red | Failed |

**Empty states:** Never blank. Every empty state has an illustration, a headline, a 1-sentence explanation, and a primary CTA.

---

## S-01: Landing Page

**Route:** `/`  
**Auth required:** No  
**File:** `src/routes/index.tsx`

### Purpose
Convert visitors to signups. Communicate the product value in 10 seconds. Show the product working.

### Layout

```
┌──────────────────────────────────────────────────────┐
│  [Logo]    Features  Pricing  Blog         [Sign In] [Get Started →] │
├──────────────────────────────────────────────────────┤
│                                                      │
│         HERO SECTION                                 │
│  "Turn every meeting into                            │
│   structured intelligence"                          │
│                                                      │
│  [Get started free →]   [Watch demo]                │
│                                                      │
│  ┌────────────────────────────────────┐             │
│  │   Dashboard preview (animated)     │             │
│  │   showing transcript + summary     │             │
│  └────────────────────────────────────┘             │
├──────────────────────────────────────────────────────┤
│  SOCIAL PROOF BAR                                    │
│  "Trusted by 2,000+ teams" · logos                   │
├──────────────────────────────────────────────────────┤
│  FEATURES (3-column grid)                            │
│  [Transcription]  [AI Summary]  [Ask Anything]       │
│  [Action Items]   [Analytics]   [Integrations]       │
├──────────────────────────────────────────────────────┤
│  HOW IT WORKS (3-step)                               │
│  1. Upload  →  2. AI processes  →  3. Search & act   │
├──────────────────────────────────────────────────────┤
│  PRICING (3 tiers)                                   │
│  Free / Pro $20/mo / Team $15/seat/mo                │
├──────────────────────────────────────────────────────┤
│  TESTIMONIALS (carousel)                             │
├──────────────────────────────────────────────────────┤
│  FINAL CTA                                           │
│  "Start turning meetings into action"                │
│  [Get started free — no credit card]                 │
├──────────────────────────────────────────────────────┤
│  FOOTER                                              │
└──────────────────────────────────────────────────────┘
```

### Key Interactions
- Dashboard preview animates on scroll-into-view (simulated typing, section reveals)
- Pricing tier toggle: Monthly / Annual (annual = 20% discount shown)
- CTA buttons scroll to sign-up section or go to `/signup`
- Sticky header on scroll

### States
- Default
- Scrolled (header becomes opaque)

---

## S-02: Sign Up

**Route:** `/signup`  
**Auth required:** No  
**File:** `src/routes/signup.tsx`

### Layout

```
┌────────────────────┬────────────────────────────────┐
│                    │                                │
│   LEFT: FORM       │   RIGHT: VISUAL PANEL          │
│                    │                                │
│   [Logo]           │   Gradient background          │
│                    │   Animated product screenshot  │
│   Create account   │                                │
│                    │   "Join 2,000+ teams..."       │
│   [Google Sign-In] │   [Testimonial quote]          │
│   ──── or ────     │   [Avatar · Name · Role]       │
│   Name    [     ]  │                                │
│   Email   [     ]  │                                │
│   Password[     ]  │                                │
│                    │                                │
│   [Create account] │                                │
│                    │                                │
│   Already have an  │                                │
│   account? Log in  │                                │
│                    │                                │
└────────────────────┴────────────────────────────────┘
```

### Validation
- Name: required, min 2 chars
- Email: valid format, unique (checked on submit)
- Password: min 8 chars, 1 uppercase, 1 number
- Real-time validation on blur (not while typing)
- Submit disabled until all fields valid

### States
- Default
- Loading (spinner in button, fields disabled)
- Field error (red border + message below field)
- Submit error (toast: "Email already in use" / "Something went wrong")
- Success → redirect to `/app/` + onboarding flow

### Mobile
- Single column; right panel hidden
- Google sign-in button full width

---

## S-03: Log In

**Route:** `/login`  
**Auth required:** No  
**File:** `src/routes/login.tsx`

### Layout
Same two-column shell as Sign Up.

```
│   Welcome back       │
│                      │
│   [Google Sign-In]   │
│   ──── or ────       │
│   Email   [        ] │
│   Password[        ] │
│             [Forgot?]│
│                      │
│   [Sign in]          │
│                      │
│   No account? Sign up│
```

### States
- Default
- Loading
- Error: "Invalid email or password" (generic — don't reveal which field is wrong)
- Success → redirect to `/app/` or the originally requested protected route

---

## S-04: Forgot Password

**Route:** `/forgot-password`  
**Auth required:** No  
**File:** `src/routes/forgot-password.tsx`

### Layout
Centered card (no two-column layout):

```
┌────────────────────────────┐
│  ← Back to login           │
│                            │
│  Reset your password       │
│  Enter your email and      │
│  we'll send a reset link.  │
│                            │
│  Email [                 ] │
│                            │
│  [Send reset link]         │
└────────────────────────────┘
```

### States
- Default
- Loading
- Success: "Check your email for a reset link" (replace form with confirmation)
- Error: "No account with that email" — still show success message (prevents user enumeration)

---

## S-05: Email Verification

**Route:** `/verify-email` (redirected from email link)  
**Auth required:** No

### States
- Verifying (spinner): "Verifying your email..."
- Success: "Email verified. Taking you to your dashboard..." → auto-redirect to `/app/`
- Error: "Link expired. Request a new one." + CTA button

---

## S-06: Dashboard

**Route:** `/app/`  
**Auth required:** Yes  
**File:** `src/routes/app/index.tsx`

### Purpose
Central hub. At-a-glance view of activity, pending work, and recent meetings.

### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ SIDEBAR │  Dashboard                     [Search] [🔔] [Avatar]  │
│         ├──────────────────────────────────────────────────────  │
│  Nav    │  STATS BAR (4 cards)                                   │
│  Items  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│         │  │ 24        │ │ 47h 30m  │ │ 38       │ │ 12       │ │
│         │  │ Meetings  │ │ Transcribed│ │Summaries │ │ Actions  │ │
│         │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ │
│         │                                                         │
│         │  ┌────────────────────────┐  ┌───────────────────────┐ │
│         │  │ RECENT MEETINGS        │  │ PENDING ACTION ITEMS  │ │
│         │  │                        │  │                       │ │
│         │  │ ○ Design Review  1h ago│  │ ☐ Deploy auth fix     │ │
│         │  │ ○ Sprint Planning 3h   │  │   Due: Today · Suhaas │ │
│         │  │ ○ Investor Call  1d    │  │                       │ │
│         │  │ ○ Team Standup   2d    │  │ ☐ Update API docs     │ │
│         │  │ ○ Customer Call  3d    │  │   Due: Fri · Maya     │ │
│         │  │                        │  │                       │ │
│         │  │ [View all meetings →]  │  │ [View all items →]    │ │
│         │  └────────────────────────┘  └───────────────────────┘ │
│         │                                                         │
│         │  ACTIVITY CHART (meetings per day, last 30 days)       │
│         │  [Recharts BarChart]                                    │
│         │                                                         │
└─────────┴─────────────────────────────────────────────────────────┘
```

### States
- Loading: skeleton loaders for each panel (not spinners — preserves layout)
- Empty (new user): full-page empty state with illustration, headline "Process your first meeting", [Upload audio →] CTA
- Populated: as above
- Action item overdue: red badge on item, "Overdue" chip

### Key Interactions
- Clicking a meeting row → `/app/meetings/:id`
- Clicking "View all meetings" → `/app/meetings`
- Checking off an action item → inline complete (optimistic update)
- Stats cards are clickable: meetings card → `/app/meetings`, actions card → `/app/action-items`

---

## S-07: Upload

**Route:** `/app/upload`  
**Auth required:** Yes  
**File:** `src/routes/app/upload.tsx`

### Purpose
Primary entry point for adding new meetings to EchoBrief.

### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ SIDEBAR │  Upload Meeting                                         │
│         ├───────────────────────────────────────────────────────  │
│         │                                                         │
│         │  ┌───────────────────────────────────────────────────┐ │
│         │  │                                                   │ │
│         │  │           ↑                                       │ │
│         │  │    Drag & drop your audio file                    │ │
│         │  │    MP3, WAV, M4A, MP4 (audio), WEBM · Max 500MB  │ │
│         │  │                                                   │ │
│         │  │         [Browse files]                            │ │
│         │  │                                                   │ │
│         │  └───────────────────────────────────────────────────┘ │
│         │                                                         │
│         │  MEETING DETAILS (shown after file selected)           │
│         │  Title       [Auto-detected or type here        ]      │
│         │  Date        [2026-05-14                         ]      │
│         │  Language    [English (auto-detect)       ▼     ]      │
│         │  Tags        [+ Add tag                         ]      │
│         │                                                         │
│         │  [Upload and process →]                                │
│         │                                                         │
└─────────┴─────────────────────────────────────────────────────────┘
```

### States

**State 1 — Idle (no file):**
Drop zone with dashed border, subtle hover animation.

**State 2 — File selected (pre-upload):**
Drop zone replaced by file card:
```
┌──────────────────────────────────────────┐
│ 🎵 team-standup-may14.mp3               │
│    47.2 MB · 1:23:04                   ✕ │
└──────────────────────────────────────────┘
```
Meeting details form appears below.

**State 3 — Uploading:**
Progress bar with percentage. Upload speed shown. Cancel button.
```
Uploading...  ████████████░░░░░░  67%   2.1 MB/s   [Cancel]
```

**State 4 — Upload complete:**
Checkmark animation. Auto-transition to Processing Status screen after 1 second.

**State 5 — Error:**
Red border on drop zone, specific error message (file too large, wrong format, network error).

### Validation
- Client-side: file type check before upload starts (MIME type + extension)
- File size: warn at 200MB, block at 500MB
- Audio duration: detect via `AudioContext`, warn if > 4 hours

### Mobile
- No drag-and-drop (not supported on mobile); show only "Browse files" button
- Camera/voice recorder option (record directly, V2)

---

## S-08: Processing Status

**Route:** `/app/meetings/:id` (while `status !== 'complete'`)  
**Auth required:** Yes

### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ SIDEBAR │  Processing your meeting...                             │
│         ├───────────────────────────────────────────────────────  │
│         │                                                         │
│         │  team-standup-may14.mp3  ·  1:23:04                    │
│         │                                                         │
│         │  PIPELINE STEPS                                         │
│         │                                                         │
│         │  ✓  Uploaded                          Complete          │
│         │  ◉  Transcribing audio...             In progress       │
│         │  ○  Generating AI summary             Waiting           │
│         │  ○  Extracting action items           Waiting           │
│         │  ○  Indexing for search               Waiting           │
│         │                                                         │
│         │  ─────────────────────────────────                     │
│         │  Estimated time remaining: ~4 minutes                   │
│         │                                                         │
│         │  [← Upload another]    [Notify me by email]            │
│         │                                                         │
└─────────┴─────────────────────────────────────────────────────────┘
```

### States
- Each step transitions: Waiting → In Progress (pulsing dot) → Complete (checkmark)
- On completion: success animation, auto-redirect to Meeting Detail in 2 seconds
- On failure: specific step shown as failed, retry button, support link

### Polling behavior
Poll `GET /api/v1/meetings/:id/status` every 5 seconds. Show "Notify me by email" for users who close the tab — they'll be emailed on completion.

---

## S-09: Meetings List

**Route:** `/app/meetings`  
**Auth required:** Yes  
**File:** `src/routes/app/meetings/index.tsx`

### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ SIDEBAR │  Meetings                    [Search...] [+ Upload new] │
│         ├───────────────────────────────────────────────────────  │
│         │  FILTERS                                                │
│         │  [All ▼]  [Any date ▼]  [Any status ▼]  [Any tag ▼]   │
│         │                                                         │
│         │  RESULTS (sorted: newest first)                        │
│         │                                                         │
│         │  ┌──────────────────────────────────────────────────┐  │
│         │  │ ● Design Review · 14 May 2026 · 1h 23m          │  │
│         │  │   3 participants · 5 action items · #design #ux  │  │
│         │  │   "Discussed new component library and..."       │  │
│         │  │                             [Complete ✓] [···]   │  │
│         │  ├──────────────────────────────────────────────────┤  │
│         │  │ ● Sprint Planning · 13 May 2026 · 58m           │  │
│         │  │   ...                                            │  │
│         │  └──────────────────────────────────────────────────┘  │
│         │                                                         │
│         │  Showing 1–20 of 47  [← Prev]  [1] [2] [3]  [Next →] │
└─────────┴─────────────────────────────────────────────────────────┘
```

### States
- Loading: skeleton rows
- Empty (no meetings): empty state with illustration + "Upload your first meeting"
- Empty (filtered): "No meetings match your filters" + [Clear filters]
- Populated: list with pagination

### Key Interactions
- Clicking a row → `/app/meetings/:id`
- Search: real-time filtering as user types (client-side for ≤ 100 meetings, server-side beyond)
- Status filter, Date filter, Tag filter: independent, composable
- Row overflow menu (···): Rename, Share, Delete
- Bulk select mode (V2): checkbox per row, bulk export/delete

---

## S-10: Meeting Detail

**Route:** `/app/meetings/:id`  
**Auth required:** Yes  
**File:** `src/routes/app/meetings/$id.tsx`

### Purpose
The most important screen. Where users spend most of their time.

### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ SIDEBAR │  Design Review · 14 May 2026 · 1h 23m     [Share] [···]│
│         ├───────────────────────────────────────────────────────  │
│         │                                                         │
│         │  TABS: [Summary] [Transcript] [Action Items] [Chat]    │
│         │                                                         │
│         ├─────────────────────────┬──────────────────────────────┤
│         │  TRANSCRIPT PANEL       │  SUMMARY PANEL               │
│         │  (left, scrollable)     │  (right, sticky top)         │
│         │                         │                              │
│         │  [Search transcript...] │  EXECUTIVE SUMMARY           │
│         │                         │  Discussed new component     │
│         │  00:00  Speaker 1        │  library decision and...    │
│         │  "Let's kick off with   │                              │
│         │   the sprint goals..."  │  KEY TOPICS                  │
│         │                         │  · Design system             │
│         │  00:45  Speaker 2        │  · Sprint capacity           │
│         │  "I wanted to raise     │  · Auth refactor             │
│         │   the auth issue..."    │                              │
│         │                         │  DECISIONS MADE              │
│         │  [Load more...]         │  · Use Radix for components  │
│         │                         │  · Auth ships before launch  │
│         │                         │                              │
│         │                         │  ACTION ITEMS (5)            │
│         │                         │  ☐ Deploy auth fix (Suhaas)  │
│         │                         │  ☐ Update API docs (Maya)    │
│         │                         │  [See all →]                 │
│         │                         │                              │
│         │                         │  [Ask about this meeting ↗]  │
│         │                         │                              │
│         └─────────────────────────┴──────────────────────────────┘
│         │                                                         │
│         │  AUDIO PLAYER (persistent bottom bar)                  │
│         │  ◀◀  ▶  ▶▶   ──────●─────────────────  00:45 / 1:23:04│
└─────────┴─────────────────────────────────────────────────────────┘
```

### States
- Loading: skeleton layout
- Transcript tab: full scrollable transcript with speaker labels and timestamps
- Summary tab: executive summary, topics, decisions, open questions
- Action Items tab: full list with complete/edit/assign/export per item
- Chat tab: per-meeting AI Q&A (F-07) — inline chat interface

### Key Interactions
- Clicking timestamp in transcript → seeks audio player
- Clicking timestamp in action item → seeks transcript + audio to that point
- "Ask about this meeting" → opens Chat tab with focus on input
- Copy summary button → copies to clipboard with confirmation toast
- Share button → toggle public link on/off, copy link
- Overflow menu (···): Rename, Add tags, Delete
- Transcript search: `Cmd+F` style highlight + navigation

### Chat Sub-panel (F-07)
```
┌────────────────────────────────────────┐
│  Ask anything about this meeting       │
│                                        │
│  ┌────────────────────────────────┐    │
│  │  What did we decide about auth?│    │
│  └────────────────────────────────┘    │
│                                        │
│  EchoBrief                             │
│  The team decided the auth refactor    │
│  must ship before the product launch.  │
│  Suhaas is the owner.                  │
│                                        │
│  Source: 00:45 — "Auth issue should   │
│  be resolved before we go live"        │
│  [Jump to timestamp →]                 │
│                                        │
│  [Ask a follow-up...]        [Send →]  │
└────────────────────────────────────────┘
```

---

## S-11: AI Chat (Cross-Meeting)

**Route:** `/app/chat`  
**Auth required:** Yes  
**File:** `src/routes/app/chat.tsx`

### Purpose
Ask questions across the entire meeting history. The "second brain" feature.

### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ SIDEBAR │  AI Chat                                                │
│         ├───────────────────────────────────────────────────────  │
│         │                                                         │
│         │  CONVERSATION AREA                                      │
│         │                                                         │
│         │  ┌─────────────────────────────────────────────────┐   │
│         │  │                                                 │   │
│         │  │  [Empty state or conversation history]          │   │
│         │  │                                                 │   │
│         │  │  You                                            │   │
│         │  │  Did we ever decide on AWS vs GCP?              │   │
│         │  │                                                 │   │
│         │  │  EchoBrief                                      │   │
│         │  │  Yes — in the Infrastructure Planning meeting   │   │
│         │  │  on April 12th, the team chose AWS. The         │   │
│         │  │  reasoning was existing team expertise and      │   │
│         │  │  lower egress costs for your use case.          │   │
│         │  │                                                 │   │
│         │  │  Sources:                                       │   │
│         │  │  · Infrastructure Planning · Apr 12 · 14:23 →  │   │
│         │  │  · Budget Review · Mar 28 · 08:11 →            │   │
│         │  │                                                 │   │
│         │  └─────────────────────────────────────────────────┘   │
│         │                                                         │
│         │  SUGGESTED QUERIES (first session, empty state)        │
│         │  "What decisions did we make last week?"               │
│         │  "Find all mentions of the pricing model"              │
│         │  "Who owns the most action items?"                     │
│         │                                                         │
│         │  ┌─────────────────────────────────────────────────┐   │
│         │  │ Ask anything about your meetings...      [Send] │   │
│         │  └─────────────────────────────────────────────────┘   │
│         │                                                         │
└─────────┴─────────────────────────────────────────────────────────┘
```

### States
- Empty state (no meetings): "Upload at least one meeting to start asking questions"
- Empty state (meetings exist, no query): suggested query chips
- Thinking: animated ellipsis while streaming starts
- Streaming response: text appears token by token
- Source citations: clickable cards below the response
- Error: "I couldn't find relevant context for that question. Try rephrasing."

### Key Interactions
- Source citations → navigate to `/app/meetings/:id` at specific timestamp
- Suggested queries → populate input and auto-submit
- Clear conversation button
- Copy response button (per message)

---

## S-12: Action Items

**Route:** `/app/action-items`  
**Auth required:** Yes  
**File:** `src/routes/app/action-items.tsx`

### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ SIDEBAR │  Action Items                [Filter ▼]  [Export ▼]   │
│         ├───────────────────────────────────────────────────────  │
│         │  TABS: [All] [My Items] [Overdue] [Completed]         │
│         │                                                         │
│         │  OVERDUE (2)                                           │
│         │  ┌──────────────────────────────────────────────────┐  │
│         │  │ ☐  Deploy auth fix                               │  │
│         │  │    Suhaas · Due: May 12 · Design Review meeting  │  │
│         │  │    [Complete] [Edit] [Export →]                  │  │
│         │  └──────────────────────────────────────────────────┘  │
│         │                                                         │
│         │  DUE THIS WEEK (3)                                     │
│         │  ┌──────────────────────────────────────────────────┐  │
│         │  │ ☐  Update API documentation                      │  │
│         │  │    Maya · Due: May 16 · Sprint Planning meeting  │  │
│         │  └──────────────────────────────────────────────────┘  │
│         │                                                         │
│         │  UPCOMING (7)                                          │
│         │  ...                                                    │
│         │                                                         │
└─────────┴─────────────────────────────────────────────────────────┘
```

### States
- All complete: celebration empty state "All caught up! 🎉"
- Filter: by assignee, by meeting, by due date range
- Export modal: select items → export to Notion/Linear/Jira (V2)

### Key Interactions
- Checkbox: mark complete (optimistic update, strikethrough animation)
- Item row click → expands inline to show full description + edit controls
- Meeting link on each item → `/app/meetings/:id` at the source timestamp
- Bulk select + bulk complete/export (V2)

---

## S-13: Shared Notes

**Route:** `/app/shared`  
**Auth required:** Yes  
**File:** `src/routes/app/shared.tsx`

### Purpose
Collaborative documents that are enriched with meeting context. V1 is read-only AI-generated notes; V2 is collaborative editing.

### Layout
Simple document list view → document detail with rich text content pulled from meeting summaries and AI-generated briefs.

---

## S-14: Analytics

**Route:** `/app/analytics`  
**Auth required:** Yes  
**File:** `src/routes/app/analytics.tsx`

### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ SIDEBAR │  Analytics                     [Last 30 days ▼]        │
│         ├───────────────────────────────────────────────────────  │
│         │                                                         │
│         │  SUMMARY ROW (4 stats cards)                           │
│         │  [Total meetings] [Hours processed] [Avg score] [Tasks]│
│         │                                                         │
│         │  ┌──────────────────────────┐  ┌────────────────────┐  │
│         │  │ MEETINGS OVER TIME       │  │ MEETING SCORE      │  │
│         │  │ [Area chart, 30 days]    │  │ TREND              │  │
│         │  │                          │  │ [Line chart]       │  │
│         │  └──────────────────────────┘  └────────────────────┘  │
│         │                                                         │
│         │  ┌──────────────────────────┐  ┌────────────────────┐  │
│         │  │ SPEAKER PARTICIPATION    │  │ TOP TOPICS         │  │
│         │  │ [Donut chart per person] │  │ [Tag cloud / list] │  │
│         │  └──────────────────────────┘  └────────────────────┘  │
│         │                                                         │
│         │  ACTION ITEM COMPLETION RATE                           │
│         │  [Progress bars by meeting]                            │
│         │                                                         │
└─────────┴─────────────────────────────────────────────────────────┘
```

### Charts Used
- Meetings over time: Recharts `AreaChart`
- Meeting score trend: Recharts `LineChart`
- Speaker participation: Recharts `PieChart`
- Action completion: Recharts `BarChart`

### States
- Insufficient data (< 3 meetings): explain minimum data needed + progress indicator
- Date range picker: last 7d, 30d, 90d, custom range

---

## S-15: Settings

**Route:** `/app/settings`  
**Auth required:** Yes  
**File:** `src/routes/app/settings.tsx`

### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ SIDEBAR │  Settings                                               │
│         ├───────────────────────────────────────────────────────  │
│         │  SETTINGS TABS (left sidebar within settings):         │
│         │  Profile · Workspace · Integrations · Billing ·        │
│         │  Notifications · API Keys · Appearance · Danger        │
│         │                                                         │
│         │  ACTIVE TAB CONTENT (right)                            │
│         │                                                         │
└─────────┴─────────────────────────────────────────────────────────┘
```

### Tab: Profile
- Avatar upload
- Display name
- Email (read-only, shows "change email" flow)
- Password change
- Language preference

### Tab: Workspace (V3)
- Workspace name + logo
- Invite members by email
- Manage members (role, remove)
- Workspace usage stats

### Tab: Integrations (V2)
- List of supported integrations with connect/disconnect buttons
- OAuth status (connected / not connected)
- Test connection button

### Tab: Billing
- Current plan display
- Usage this month (meetings, hours, storage)
- Upgrade/downgrade CTA
- Invoice history

### Tab: Notifications
- Email on: processing complete, @mentions, action item due soon
- Browser push: opt-in

### Tab: API Keys
- Generate + revoke API keys (developer access)
- Usage per key

### Tab: Appearance
- Accent color picker (within brand palette)
- Compact mode toggle (reduces spacing)

### Tab: Danger Zone
- Delete account (double-confirm modal: type "DELETE" to confirm)
- Export all data (GDPR download)

---

## S-16: Smart Timeline View (V2)

**Route:** `/app/meetings/:id?view=timeline`  
**Auth required:** Yes

### Layout
Replaces transcript panel with a visual chapter-based timeline:

```
┌────────────────────────────────────────────┐
│  TIMELINE                                  │
│                                            │
│  00:00 ─── Sprint Goals        ─── 12:30  │
│  12:30 ─── API Architecture    ─── 22:10  │
│  22:10 ─── Hiring Discussion   ─── 34:50  │
│  34:50 ─── Q&A / Blockers      ─── 58:04  │
│                                            │
│  [Click any chapter → jump to that point] │
└────────────────────────────────────────────┘
```

Each chapter expands to show its summary and the action items sourced from it.

---

## S-17: Meeting Score Detail (V2)

Accessible from Meeting Detail header. Shows the 5-component breakdown with explanations and comparison to the user's average.

---

## S-18: Integrations Hub (V2)

**Route:** `/app/settings/integrations` (expanded from Settings tab)

Full-page view showing all integrations with:
- Connection status + last synced time
- Configuration options per integration
- Export history (what was sent where)

---

## S-19: Email Generator (V2)

Modal or side panel triggered from Meeting Detail:

```
┌────────────────────────────────────────────┐
│  Generate meeting email                    │
│                                            │
│  Type: [Meeting Recap      ▼]             │
│  Tone: [Professional       ▼]             │
│                                            │
│  [Generate]                               │
│                                            │
│  ─────────────────────────────────────    │
│  Subject: Design Review Recap — May 14    │
│                                            │
│  Hi team,                                 │
│  ...AI-generated email body...            │
│                                            │
│  [Copy to clipboard]  [Open in Gmail]     │
└────────────────────────────────────────────┘
```

---

## S-20: Live Transcription (V3)

**Route:** `/app/live`  
**Auth required:** Yes

### Layout
Full-screen focus mode:

```
┌──────────────────────────────────────────────────────────────────┐
│  ● LIVE  Design Review  [00:23:14]                   [Stop ■]    │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  LIVE TRANSCRIPT (auto-scrolling)       LIVE ACTION ITEMS        │
│                                                                  │
│  Speaker 1: "Let's discuss the          ☐ Auth fix before launch │
│  auth architecture..."                     (detected 2 min ago) │
│                                                                  │
│  Speaker 2: "The main issue is the      ☐ Review API docs        │
│  JWT expiry handling..."                   (detected just now)  │
│                                                                  │
│  ▌ (live cursor)                                                 │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## S-21: Team Workspace (V3)

**Route:** `/app/workspace`  
**Auth required:** Yes (Admin or Member)

Team-level view: all meetings across workspace, shared action items, member activity feed, usage dashboard for Admins.

---

## S-22: Shared Meeting View (Public Link)

**Route:** `/share/:token`  
**Auth required:** No (public URL)

Stripped-down read-only view of a specific meeting:
- Title, date, duration
- Summary only (transcript hidden by default, owner can enable it)
- Action items (read-only)
- No sidebar, no nav — clean shareability
- Branding: "Powered by EchoBrief"

---

## Screen Inventory Summary

| # | Screen | Route | V1 | V2 | V3 |
|---|--------|-------|----|----|----|
| S-01 | Landing Page | `/` | ✓ | | |
| S-02 | Sign Up | `/signup` | ✓ | | |
| S-03 | Log In | `/login` | ✓ | | |
| S-04 | Forgot Password | `/forgot-password` | ✓ | | |
| S-05 | Email Verification | `/verify-email` | ✓ | | |
| S-06 | Dashboard | `/app/` | ✓ | | |
| S-07 | Upload | `/app/upload` | ✓ | | |
| S-08 | Processing Status | `/app/meetings/:id` (in-progress) | ✓ | | |
| S-09 | Meetings List | `/app/meetings` | ✓ | | |
| S-10 | Meeting Detail | `/app/meetings/:id` | ✓ | | |
| S-11 | AI Chat (Cross-Meeting) | `/app/chat` | ✓ | | |
| S-12 | Action Items | `/app/action-items` | ✓ | | |
| S-13 | Shared Notes | `/app/shared` | ✓ | | |
| S-14 | Analytics | `/app/analytics` | ✓ | | |
| S-15 | Settings | `/app/settings` | ✓ | | |
| S-16 | Smart Timeline View | `/app/meetings/:id?view=timeline` | | ✓ | |
| S-17 | Meeting Score Detail | (modal) | | ✓ | |
| S-18 | Integrations Hub | `/app/settings/integrations` | | ✓ | |
| S-19 | Email Generator | (modal/panel) | | ✓ | |
| S-20 | Live Transcription | `/app/live` | | | ✓ |
| S-21 | Team Workspace | `/app/workspace` | | | ✓ |
| S-22 | Shared Meeting View | `/share/:token` | ✓ | | |
