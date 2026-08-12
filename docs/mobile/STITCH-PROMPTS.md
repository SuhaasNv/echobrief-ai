# Stitch prompts — EchoBrief iOS

Paste these into Google Stitch (stitch.withgoogle.com). The MCP endpoint returns a
malformed tool schema, so use the web UI.

**How to use:** paste the Design System block first and let it generate, then run each
screen prompt as a follow-up in the same project so it inherits the system. Stitch
responds better to concrete nouns and hex values than to adjectives — resist the urge
to add words like "beautiful", "modern", or "sleek", which produce generic output.

---

## 0. Design system (paste first)

```
Design a dark iOS mobile app design system for "EchoBrief", an AI meeting
intelligence app. Near-black, restrained, instrument-panel aesthetic — closer to a
precision measuring device than a consumer social app.

COLORS (use these exact values, do not substitute):
Canvas background: #06070A
Card surface: #0B0D11
Elevated surface: #121418
Recessed well: #030407
Primary text: #F4F5F7
Secondary text: #9CA1A9
Tertiary text: #6E727A
Hairline border: rgba(255,255,255,0.10)
Accent blue (navigation, links, timestamps): #4C99F8
Accent violet (AI-generated content ONLY): #A27DFA
Success: #2FC183
Warning: #E6AC3D
Danger: #FF5F62
Speaker colors: #4C99F8, #A27DFA, #2FC183, #E6AC3D, #7A869F

TYPOGRAPHY:
Display face: Space Grotesk Bold — large titles, big numbers, timers only
Body face: SF Pro / system sans — everything else
Monospace: SF Mono — all timestamps, durations, counts, IDs
Body 17px/25. Secondary 15px. Metadata 13px.
Section labels: 11px, UPPERCASE, letter-spacing 0.8px, weight 600, tertiary color

STYLE RULES:
- Cards have 16px corner radius, 1px rgba(255,255,255,0.10) border, and a 1px
  rgba(255,255,255,0.12) highlight on the TOP EDGE ONLY, like light from above
- No drop shadows as the primary depth cue. Depth comes from surface value and edges
- Primary buttons are near-white (#F4F5F7) pills with dark text — NOT blue
- Violet appears only on AI-generated content. Never on navigation or selection
- No sparkle icons. No purple gradients. No glassmorphism. No neon glow
- Generous vertical spacing: 24px between sections, 20px card padding
```

---

## 1. Meetings list

```
Design the main list screen for EchoBrief using the established design system.

iOS large title "Meetings" at top left, collapsing on scroll. Search field below it.

A vertical list of meeting cards, 10px apart, 16px side margins. Each card contains,
top to bottom:

1. Meeting title in 17px semibold white, with a relative date ("Today", "Yesterday",
   "Tue") right-aligned in 13px grey
2. Two lines of AI summary preview in 15px grey
3. THE SIGNATURE ELEMENT: a horizontal 3px-tall bar spanning the full card width,
   divided into segments of different colors along its length. Each color is a
   different speaker in the conversation, sized by how long they spoke. Think of it
   as a fingerprint of the conversation — a monologue is one long band, a debate is
   many alternating bands. Use the speaker colors from the system.
4. A metadata line in monospace 13px grey: "42 min · 4 speakers · 3 tasks", with a
   small rounded score chip right-aligned showing a number like "82"

Some cards show an amber "Transcribing" pill instead of the score, for meetings still
being processed — their colored bar is a flat grey placeholder.

Bottom tab bar with 5 items: Meetings, Ask, Record (center, emphasized), Actions,
Account.
```

---

## 2. Meeting detail

```
Design the meeting detail screen for EchoBrief using the established design system.

Top: meeting title in Space Grotesk 28px. Below it a row of small rounded pills:
date, duration, and a stack of overlapping circular speaker avatars.

HERO ELEMENT: a 28px-tall horizontal bar spanning the screen width with 6px rounded
corners, divided along its length into colored segments — one color per speaker,
sized by speaking time. A thin white vertical playhead line sits partway across it.
Below it, a legend: small colored dots with speaker names.

Below that, a segmented control with three tabs: Summary, Transcript, Actions.

Summary tab content, as separate cards:

- AI SUMMARY card with a 2px violet vertical rule down its left edge, an uppercase
  label, and a paragraph of summary text at 17px
- TOPICS card with small rounded grey chips
- DECISIONS card with green checkmark bullets
- MEETING SCORE card: uppercase label, then a very large monospace number "82",
  then five thin horizontal progress bars in violet labeled PARTICIPATION,
  ACTIONABILITY, FOCUS, CLARITY, EFFICIENCY in 9px uppercase
- TALK TIME card: one row per speaker with a horizontal bar in that speaker's color
  and a percentage on the right

Pinned at the bottom: a floating frosted-glass playback bar with play button,
15-second skip buttons, monospace "12:04 / 42:18", and a "1x" speed pill.
```

---

## 3. Record

```
Design the recording screen for EchoBrief using the established design system, but
with a pure black #000000 background for this screen only.

Top: a small red dot next to "RECORDING" in 10px uppercase monospace letter-spaced
grey.

Below: an editable meeting title in 22px.

Center: an enormous elapsed timer "00:14:32" in monospace 56px white, with evenly
spaced digits.

Below the timer: a live audio waveform made of vertical rounded bars, 4px wide with
2px gaps, mirrored symmetrically around a horizontal center line, roughly 56 bars
wide. Bars in the middle are tall, they shrink toward both edges, and the outermost
bars fade to transparent.

Below the waveform: a horizontal colored bar building up from the left — segments in
different colors representing each speaker as they are identified in real time. The
right portion is still empty dark grey, waiting to be filled.

Below that: the last three lines of live transcript, the most recent in white and
older lines fading to grey.

Bottom: two buttons side by side — a circular outlined "Pause" button, and a wider
filled red "End Meeting" button.

No decorative glow. No gradient. Keep it stark and instrument-like.
```

---

## 4. Ask

```
Design the AI search screen for EchoBrief using the established design system.

iOS large title "Ask".

Empty state: an uppercase monospace label "ASK ACROSS 47 MEETINGS", then three
suggested question chips stacked vertically in rounded grey containers:
"What did we decide about pricing?"
"What's blocking the launch?"
"What did Sarah commit to?"

Answered state, top to bottom:

1. The user's question right-aligned in a grey rounded bubble
2. A status line with a violet outline pill reading "Searching 47 meetings" with a
   small spinner
3. The answer as flowing text at 17px white, with a thin violet vertical caret at
   the end suggesting it is still being typed out
4. Inline citation chips within the text — small rounded grey pills reading
   "Weekly Marketing Call · 12:40"
5. An uppercase monospace label "SOURCES · 4", then a horizontally scrolling row of
   small cards. Each source card leads with a small horizontal multi-colored
   segmented bar (the speaker fingerprint), then the meeting name and a monospace
   timestamp.

Bottom: a text input with a violet circular send button.
```

---

## 5. Action items

```
Design the action items screen for EchoBrief using the established design system.

iOS large title "Action items", with a segmented control below it: Open / Done.

The list is grouped under uppercase monospace section headers with counts:
"OVERDUE · 2" in red, then "TODAY · 3", "THIS WEEK · 5", "NO DUE DATE · 4" in grey.

Each item is a card containing:
- A circular unchecked checkbox on the left, 26px, thin ring
- The task text at 15px white, up to two lines
- Below it, a small multi-colored horizontal segmented bar fragment, then the source
  meeting name and a monospace timestamp like "Weekly Marketing · 12:40"
- Below that, the assignee name and relative due date at 13px grey

Overdue items have a red ring on the checkbox and a red due date.

Show one item mid-completion: its checkbox filled green with a checkmark and the row
at reduced opacity, fading out.
```

---

## 6. Sign in

```
Design the sign-in screen for EchoBrief using the established design system.

The screen splits in half horizontally.

TOP HALF: a full-bleed abstract visual — an iridescent soap-bubble-like orb
floating in pure black, with rainbow refraction across its surface. It fades into
the black background at its lower edge via a soft vertical gradient, with no hard
line where it ends.

BOTTOM HALF, on solid #06070A:
- "EchoBrief" in Space Grotesk Bold, 40px, white, left-aligned
- "Your meetings, remembered." below it in 17px grey
- An email field: 52px tall, #0B0D11 background, 12px radius, 17px placeholder
- A password field, same styling, with a blue "Show" text button on its right
- A primary button: full width, 52px tall, fully rounded pill, near-white #F4F5F7
  background with dark #06070A text reading "Sign in"
- Centered below: "New to EchoBrief? Create an account", where the second part is
  blue

No social login buttons. No "or continue with" divider.
```

---

## 7. Sign up

```
Design the account creation screen for EchoBrief using the established design
system. Same structure as sign-in but no video — solid #06070A throughout.

A back chevron in the top left.

"Create an account" in Space Grotesk Bold 40px.
"Start turning meetings into summaries you can search." in 17px grey.

Three stacked fields, each 52px tall with #0B0D11 background and 12px radius:
Name (optional), Email, Password.

Below the password field, a small 13px line reading "At least 8 characters" in
green with a checkmark, indicating the requirement is satisfied.

A near-white pill button reading "Create account".
```

---

## 8. Meeting chat

```
Design a chat screen for asking questions about ONE specific meeting, using the
established design system.

Navigation bar shows the meeting name with a smaller grey subtitle underneath
reading "Grounded on this transcript".

Empty state: an uppercase monospace label "TRY ASKING", then four suggestion cards
stacked vertically, each a rounded #0B0D11 container with 15px white text:
"Give me a 3-bullet summary"
"What decisions were made, and by whom?"
"List the action items with owners"
"What was left open for next time?"

Conversation state:
- User messages right-aligned in rounded grey #121418 bubbles, max 85% width
- AI responses NOT in bubbles — full-width flowing text at 17px, with a small
  violet dot marker at the start of each response
- A thin violet vertical caret at the end of the most recent response, suggesting
  live typing

Bottom: a rounded text input with placeholder "Ask about this meeting" and a
circular violet send button with an up arrow.
```

---

## 9. Account

```
Design the account screen for EchoBrief using the established design system.

iOS large title "Account".

At the top, a profile row: a 56px circle showing the initials "MN" in Space Grotesk
on a #121418 background, with the name "Maya Nakamura" in 17px semibold and
"maya@acme.com" in 15px grey beside it.

Then a section labeled "WORKSPACE" in uppercase monospace 11px grey, containing one
grouped card row: a small colored dot, "Personal", and a chevron.

Then a section labeled "CONTINUE ON THE WEB" containing a grouped card with several
rows, each with a label on the left and a small diagonal arrow icon on the right
indicating it opens externally:
Settings and profile / Analytics / Plan and billing / Shared links / Integrations

Rows are separated by hairline dividers inset 16px from the left edge.

At the bottom, separated by空 space, a final grouped card with a single row reading
"Sign out" in red, and below it "Delete account" also in red.

Version text "1.0 (build 42)" in 13px tertiary grey, centered at the very bottom.
```

---

## 10. Processing state

```
Design the meeting detail screen for EchoBrief in its PROCESSING state, using the
established design system. This is what a user sees while the AI is still working.

Navigation bar with the meeting title.

Below it: date and duration in monospace 13px grey.

Then a flat dark grey horizontal bar with rounded ends, 28px tall, full width — a
placeholder where the colored speaker timeline will appear once processing
completes.

Center of the screen:
- A circular progress ring, roughly 120px diameter, thin stroke, mostly complete in
  blue with the remainder dark grey, and "60%" in large monospace in its center
- Below it, "Extracting summary and action items" in 17px semibold white
- Below that, a vertical checklist with four rows, left-aligned:
  ✓ Uploaded to storage        (green check, white text)
  ✓ Transcribed                (green check, white text)
  ◌ Analyzed                   (spinner, white text)
  · Indexed                    (grey dot, grey text)
- Below that, "about 2 min left" in monospace 15px grey

At the bottom, a subtle line in 15px grey: "You can close the app — we'll keep
working."
```

---

## 11. Empty states

```
Design three empty state screens for EchoBrief using the established design system.
Each is vertically centered with generous space, max 280px content width.

SCREEN 1 — No meetings yet:
A dimmed multi-colored horizontal segmented bar at 20% opacity as a background
decoration, with the text over it. "Record your first meeting" in 20px semibold
white. "EchoBrief turns it into a summary, action items, and a searchable
transcript in a couple of minutes." in 15px grey. A near-white pill button reading
"Start recording".

SCREEN 2 — No action items:
"You're all clear." in 20px semibold white, "Nothing open across 12 meetings." in
15px grey. No button.

SCREEN 3 — No search results:
"No meeting mentions that." in 20px semibold. "Try different words, or search
titles in Meetings." in 15px grey. A text button in blue reading "Ask something
else".

All three: no illustrations, no icons larger than 44px, no gradients.
```

---

## Notes on iterating

- If output looks generic, the usual cause is adjectives. Replace "modern card" with
  the actual radius, border, and padding.
- Stitch tends to add gradients and glows unprompted. Re-state "no gradients, no
  glow, flat surfaces only" in the follow-up.
- The colored speaker bar is the thing worth fighting for — it is the one element
  competitors do not have. If Stitch renders it as a plain progress bar, describe it
  as "a horizontal stacked bar chart where each segment is a different speaker".
