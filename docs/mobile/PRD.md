# EchoBrief AI — iOS 1.0 PRD

**Status:** Draft for review
**Author:** Product
**Last updated:** 2026-08-12
**Target platform:** iOS 17.0+, iPhone only, portrait (transcript + player rotate to landscape) — **[Assumption]** SwiftUI, single app target, no third-party SDKs
**Backend:** existing Hono API at `/api/v1` (Railway). No new pipeline. Three small server additions are required and named in FR-66..FR-68.

---

## 1. Summary & problem statement

### The honest version

EchoBrief's web app already does everything: upload, transcribe, diarize, summarize, extract action items, score meetings, and answer questions across the entire library. An iOS app adds exactly **one** capability the web app cannot have, and improves exactly **one** more:

| | What iOS adds | Honest assessment |
|---|---|---|
| **Capture** | Recording the room you are physically standing in — a hallway decision, a customer call on speakerphone, a standup, a 1:1 walk. Phone-in-pocket capture with the screen locked. | **This is the whole reason the app exists.** Web capture requires a laptop open, awake, with a browser tab focused and mic permission granted. That is a fundamentally different set of meetings. |
| **Ingest** | Share sheet + Files import. Voice Memos, WhatsApp voice notes, Zoom exports sitting in iCloud Drive, a recording AirDropped from a colleague — two taps instead of "email it to myself, open the laptop, drag into the browser." | **Genuinely better,** but incremental. Same pipeline, fewer steps. |
| **Review** | Meetings list, detail, summary, action items, speakers, score. | **Thin.** This is responsive web rendered in Swift. It is table stakes for the app to feel complete, not a reason to install it. |
| **Ask** | Cross-meeting semantic search, per-meeting chat. | **Thin, with one real use case:** answering "what did we decide about X?" while walking into the next meeting, when opening a laptop is not an option. Otherwise the web version is strictly better (bigger screen, citations easier to scan). |
| **Complete** | Action items list + toggle done. | **Moderately good.** Checking off work is a phone-shaped task. Editing text is not, and is out. |

We are not going to pretend the review surfaces are a differentiator. They exist because an app that only records and then dumps you into Safari is a worse product and a likely App Store rejection. The pitch is: **EchoBrief on iOS is the capture device; the pipeline and the library it already had come along for free.**

### Problem statements

- **P1 — Unrecorded meetings are invisible to EchoBrief.** The product's premise is "organizational memory." Today that memory contains only meetings someone remembered to record on a laptop. In-person conversations, hallway decisions, customer calls taken on a phone, and voice memos are structurally excluded. Every one of those is a hole in the knowledge graph, and the holes are disproportionately where decisions actually get made.
- **P2 — Ingest friction kills the habit.** Audio that already exists on the phone (Voice Memos, WhatsApp, AirDrop) requires a device transfer to reach EchoBrief. Multi-step transfers do not survive contact with a busy week.
- **P3 — The library is unreachable in the exact moment it is most valuable.** "What did we commit to last sprint?" is asked ninety seconds before the next meeting, in a hallway, with no laptop.

P1 is the one that justifies the build. P2 and P3 are supporting.

### Apple's constraint is also a product constraint

Guideline 4.2 (minimum functionality) rejects apps that are a repackaged website. Native recording, share-sheet ingest, background capture, and offline playback are the substance that clears that bar. The review surfaces alone would not.

---

## 2. Goals / Non-goals

### Goals

| # | Goal | Measure |
|---|---|---|
| G1 | Make in-person and phone-side meetings capturable | ≥ 40% of meetings created by iOS-installed users originate from the iOS recorder within 30 days of install (measured via `meetings.source`, FR-66) |
| G2 | Recording never loses data | 0 recordings lost to app termination, call interruption, storage exhaustion, or 401 during upload, across the release-criteria test matrix (RC-9) |
| G3 | Clear App Store review on first submission | Approved without a 4.2 / 4.8 / 3.1.1 / 5.1.1(v) rejection |
| G4 | The app is usable without push notifications | ≥ 90% of completed meetings are opened by their owner within 24h of completing, without any server-initiated notification |
| G5 | Review surfaces are fast enough to be trusted | Cold start → meetings list rendered ≤ 1.5s p50 on iPhone 12; list scroll holds 60fps |
| G6 | Accessible by default | Full VoiceOver traversal of every screen; Dynamic Type to AX3 without truncation or clipping |

### Non-goals for 1.0

| Cut | Reason | Type |
|---|---|---|
| Live streaming transcription | Ships in web; on mobile it doubles battery + network cost, needs a WebSocket relay under iOS background constraints, and duplicates the batch path. The user-visible delta over "record then process" is watching words appear. Not worth a 1.0 slip. | Product |
| Google / Apple sign-in | Guideline 4.8: offering Google Sign-In obliges us to also ship Sign in with Apple. That is a second auth path, a new server identity-linking flow, and an account-merge story. Email/password only. | Apple rules |
| Subscription purchase / plan changes | Guideline 3.1.1: paid digital functionality unlocked in-app must use IAP. We are not building StoreKit for 1.0. The app must therefore never link to, mention the price of, or CTA toward upgrading. | Apple rules |
| Analytics dashboard | Recharts-dense; a phone renders it badly and nobody makes a decision from a trend line on a bus. | Product |
| Flashcards / study mode | The student persona is secondary and the study loop needs its own design pass. | Product |
| Workspace create / rename / delete | Switching covers the mobile job ("record into the right place"). Administration is a desk task. | Product |
| Settings: change password, data export, delete-account UI, avatar upload | Mostly desk tasks. **Exception: account deletion is NOT cut** — see §4 pushback. | Product |
| Share-link management | Sharing a meeting publicly is a deliberate, reviewable act. Phone-sized consequences of a mis-tap are bad. | Product |
| Integrations (Notion/Linear/Jira/Calendar) | OAuth flows are incomplete server-side; nothing to connect to. | Product |
| Email generation | Composition on a phone keyboard is a poor fit; the web modal is better. | Product |
| Admin console | Internal tool. | Product |
| Push notifications | No paid Apple Developer program APNs key, no device-token storage, no server-side sender. 1.0 substitutes local notifications (FR-30..FR-33), which need none of that. | Constraint |
| iPad-optimized layout | 1.0 runs as an iPhone app on iPad (scaled). Not a supported form factor. | Product |
| Offline AI (chat/search without network) | Requires the server. Degrade explicitly. | Technical |

---

## 3. Personas & primary jobs-to-be-done

### Persona 1 — Maya, Senior PM at a 40-person startup (primary)

8–14 meetings a week, roughly half in a room or on a phone call. Lives in Linear and Notion. Already an EchoBrief web user; her library has 60+ meetings.

| | |
|---|---|
| **Top mobile JTBD** | "When I walk into an unplanned conversation that turns into a decision, I want to start recording in under 3 seconds so the decision survives." |
| **Secondary JTBD** | "Before I walk into a meeting, tell me what we decided last time — in 20 seconds, on my phone." |
| **Failure mode she fears** | Recording silently stopped, or the file vanished. Trust is binary. |
| **What she will not do on a phone** | Read a 45-minute transcript. Edit action item text. Manage workspaces. |

### Persona 2 — Dev, staff engineer, remote-first team (primary)

Fewer meetings, higher stakes: architecture reviews, incident calls, vendor evaluations. Half his calls are on a phone while walking. Skeptical of AI summaries; will check them against the transcript.

| | |
|---|---|
| **Top mobile JTBD** | "Import the voice memo I recorded during the incident and get action items out of it without opening my laptop." |
| **Secondary JTBD** | "Jump to the exact 20 seconds of the call where the vendor described the rate limit." |
| **Implication** | Tap-to-seek transcript is not a nice-to-have for Dev. It is how he verifies the summary. Playback + transcript sync must be exact, not approximate. |

### Persona 3 — Priya, ops lead / chief-of-staff type (secondary)

Owns follow-through across other people's meetings. Rarely records; constantly triages.

| | |
|---|---|
| **Top mobile JTBD** | "Clear my action item list from the train." |
| **Implication** | The action items tab must work with one thumb, survive flaky connectivity, and never lose a toggle. |

The **student** persona (flashcards) is explicitly not served by 1.0. Students may sign in and use recording + review; the study loop stays on web.

---

## 4. Scope table

`IN` = native iOS implementation. `HANDOFF` = a labeled entry point that opens the web app in `SFSafariViewController`. `OUT` = not present, not linked.

| # | Feature | 1.0 | Rationale |
|---|---|---|---|
| 1 | Email/password sign-up + sign-in | IN | Only auth path that avoids 4.8. Endpoints exist (`/auth/signup`, `/auth/login`). |
| 2 | Sign out | IN | Table stakes; token drop, no server call. |
| 3 | **Delete account** | **IN** | Guideline 5.1.1(v) makes this mandatory for any app supporting in-app account creation. See pushback below. `DELETE /account/me` already exists. |
| 4 | Forgot password | HANDOFF | Web flow exists; no email-deliverability work on mobile. |
| 5 | Meetings list + search + status/date filter | IN | The library home. `GET /meetings` already supports `q`, `status`, `from`, `to`, `tag`. |
| 6 | Meeting detail: summary, decisions, open questions, topics, chapters | IN | Primary read surface. |
| 7 | Meeting detail: transcript with speaker labels | IN | How Dev verifies the summary. |
| 8 | Meeting detail: action items | IN | Read + toggle. No text editing. |
| 9 | Meeting detail: speakers + talk time | IN | Cheap; already in `MeetingDetail`. |
| 10 | Meeting detail: meeting score + 5-component breakdown | IN | Cheap; read-only. |
| 11 | Audio playback + tap-a-segment-to-seek | IN | The verification loop. Requires signed URL (`GET /meetings/:id/audio-url`, 30-min TTL). |
| 12 | Rename meeting title | IN | 15 seconds of work; a wrongly-titled meeting is unfindable. `PATCH /meetings/:id`. |
| 13 | Rename diarized speakers | OUT | `POST /meetings/:id/speakers` exists but the interaction (map A/B/C to names against audio) is a desk task. 1.1. |
| 14 | **Native recording** (foreground, backgrounded, screen-locked) | IN | The reason the app exists. Clears 4.2. |
| 15 | Recording → upload → existing batch pipeline | IN | Presign → PUT R2 → confirm. No new server work. |
| 16 | Import audio via Share Sheet extension | IN | Persona 2's top job. |
| 17 | Import audio via Files / document picker | IN | Same job, second entry point. |
| 18 | Processing progress + status polling | IN | `GET /meetings/:id/status` returns real 4-step progress. |
| 19 | Retry a failed meeting | IN | `POST /meetings/:id/retry`. Failure without a retry button is a support ticket. |
| 20 | Delete a meeting | IN | Users record things by accident. Required for trust. |
| 21 | Action items tab (all meetings) + toggle complete | IN | Persona 3's whole job. |
| 22 | Action item text/assignee/due-date editing | OUT | Keyboard work; web is better. |
| 23 | Action item export to Notion/Linear | OUT | Integrations are stubs. |
| 24 | Cross-meeting semantic search (streaming + citations) | IN | Flagship feature; must appear. See quota caveat below. |
| 25 | Per-meeting chat (streaming) | IN | Same. |
| 26 | Citation tap → open meeting → seek to timestamp | IN | Without this, citations are decoration. |
| 27 | Workspace switch | IN | One `x-workspace-id` header. Prevents recording into the wrong workspace. |
| 28 | Workspace create / rename / delete | HANDOFF | Admin task. |
| 29 | Live streaming transcription | HANDOFF | See non-goals. |
| 30 | Analytics dashboard | HANDOFF | |
| 31 | Flashcards / study | HANDOFF | |
| 32 | Password change, data export, avatar | HANDOFF | |
| 33 | Subscription / billing / plan comparison | **OUT — not even HANDOFF** | 3.1.1. No price, no "upgrade" CTA, no link to a pricing page anywhere in the binary. |
| 34 | Share-link create/revoke | HANDOFF | |
| 35 | Email generation | HANDOFF | |
| 36 | Admin console | OUT | |
| 37 | Local notification on processing complete | IN | The only viable substitute for push. |
| 38 | Offline: cached list + cached detail readable | IN | Trains, elevators, basements. |
| 39 | Offline: record + queue upload | IN | Recording must never depend on a network. |

### Where the agreed scope produces a bad experience — say it plainly

**4a. No push means the async pipeline has no completion signal.** Processing takes minutes. Without APNs the user records, backgrounds the app, and the app has no reliable way to tell them it finished. The mitigation (local notification scheduled from `estimated_seconds_remaining`, corrected by a `BGAppRefreshTask` poll — FR-30..FR-33) is genuinely decent, but it will occasionally fire early on a meeting that then fails, or fire late if iOS never schedules the refresh task. **Accepted for 1.0, but this is the single largest UX debt in the release, and 1.1 should buy the developer account and ship APNs.**

**4b. Free tier gives the flagship feature 10 uses per month.** `usage-tracker` caps free accounts at 10 AI queries/month across chat + search combined. A new iOS user who tries cross-meeting search five times on day one has half their month gone, and — because billing is cut under 3.1.1 — the app cannot even tell them how to fix it beyond "open the web app." That is a bad first-run experience for the feature we lead with in marketing. FR-58 requires the 429 copy be honest and non-commercial; it does not make the problem go away.

**4c. Handoff drops the user at the web login screen.** The iOS token lives in Keychain; the web app reads its token from `localStorage`. There is no session-transfer endpoint. Every HANDOFF row above therefore costs the user a full re-login in Safari. For a portfolio demo this reads as a seam. FR-63 requires the handoff sheet to warn about it; a one-time handoff-token endpoint is proposed for 1.1 (§11) and raised as OQ-3.

**4d. Read-only action items will frustrate.** Persona 3 will inevitably want to fix a wrong assignee from the train. We are shipping a checkbox and no pencil. Deliberate; revisit in 1.1 with usage evidence.

### Pushback on the agreed scope

| Item | Agreed scope says | I disagree | Why |
|---|---|---|---|
| **Account deletion** | OUT ("settings") | **Must be IN.** | App Review guideline 5.1.1(v): an app that supports account creation must let the user *initiate* deletion from within the app. Linking to a web page is not reliably accepted. This is a near-certain rejection. Cost is one destructive-confirmation screen calling an endpoint that already exists. Cheapest insurance in the release. |
| **Rename meeting title** | not listed | **Add to IN.** | Recordings default to a generated title. An untitled/mistitled meeting is unfindable in the list, which breaks feature #5. `PATCH /meetings/:id` already accepts `title`. ~30 minutes of work. |
| **Delete meeting** | not listed | **Add to IN.** | Accidental recordings are a certainty on a phone, and a user who cannot delete a bad recording will delete the app instead. Also a privacy expectation. |
| **Retry failed meeting** | not listed | **Add to IN.** | Processing does fail (`status: failed`, `failure_reason`). A dead end with no action is worse than no feature. |
| **Import format whitelist** | assumed to "just work" | **Needs explicit spec.** | The server's `SupportedMime` enum accepts nine types. iOS share-sheet sources commonly produce `.caf`, `.aiff`, `.aac`, `.flac`, `.ogg` — all rejected server-side with an opaque 400. FR-25/FR-26 require client-side detection plus an AVAssetExportSession transcode to `m4a` before presigning. Without this, share-sheet import fails unpredictably and the feature reads as broken. |
| **Speaker renaming** | OUT | Agreed, but flag it | Diarization output is `A`/`B`/`C` until someone names them, and unnamed speakers make the transcript materially harder to read on a small screen. Accepted for 1.0; first item in 1.1. |

---

## 5. Functional requirements

Every requirement below is written so a QA engineer can pass or fail it without asking an engineer what it means.

### 5.1 Authentication & session

| ID | Requirement |
|---|---|
| FR-1 | Sign-up screen collects email, password, and optional name, and calls `POST /api/v1/auth/signup`. Password field enforces ≥ 8 characters client-side before enabling Submit (server minimum is 8). |
| FR-2 | Sign-in screen calls `POST /api/v1/auth/login`. On success the app stores the returned JWT and navigates to the meetings list. |
| FR-3 | Auth failures display the server's message verbatim. QA must confirm that a wrong password and an unregistered email produce **identical** on-screen text — the API is deliberately anti-enumeration and the client must not add a distinguishing hint. |
| FR-4 | No Google, Apple, Facebook, or any third-party sign-in button exists anywhere in the binary. QA fails this on any such control being present, hidden, or feature-flagged. |
| FR-5 | The JWT is stored in Keychain with `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`. QA verifies via a device backup inspection or a debug build assertion that it is not in `UserDefaults`, a plist, or a file. |
| FR-6 | Tokens are valid 7 days with no refresh endpoint. When any request returns 401, the app clears the token and the cached workspace ID, and routes to sign-in with the message "Your session expired. Sign in again." |
| FR-7 | **A 401 must never destroy user data.** If a 401 occurs while a recording is uploading or queued, the recording stays on disk in the upload queue, and after successful re-auth the upload resumes automatically. QA test: sign in, start a 5-minute recording, invalidate the token server-side, stop recording, observe re-auth prompt, sign in, confirm the meeting appears and completes. |
| FR-8 | On cold launch with a stored token, the app calls `GET /account/me` before showing the library. Success → library. 401 → sign-in. Network failure → library in offline mode (FR-52). |
| FR-9 | Sign out clears the Keychain token, the cached workspace ID, all cached meeting/transcript data, and any queued-but-unstarted uploads is **retained** (not deleted) and surfaced on next sign-in as "1 recording waiting to upload." QA verifies cached transcripts are unreadable after sign-out. |
| FR-10 | Settings contains "Delete account", behind a two-step confirmation requiring the user to type `DELETE`. Calls `DELETE /api/v1/account/me`, then performs FR-9 sign-out including purging queued uploads. Success copy states that meetings, transcripts, and audio are permanently removed. |
| FR-11 | "Forgot password?" on the sign-in screen opens the web forgot-password page in `SFSafariViewController`. |
| FR-12 | Auth endpoints are rate-limited (5 attempts / 15 min; sign-up 3 / hour). On 429 the app shows the retry window and disables the submit button until it elapses. |

### 5.2 Workspaces

| ID | Requirement |
|---|---|
| FR-13 | On sign-in the app fetches `GET /workspaces` and sets the active workspace to the previously selected one if still present, else the first returned. |
| FR-14 | Every authenticated request sends `x-workspace-id: <active workspace id>`. |
| FR-15 | A workspace switcher is reachable in ≤ 2 taps from the library and from the pre-record screen. Switching invalidates all cached lists and re-fetches. |
| FR-16 | If any request returns 403 with a message matching "not a member of this workspace", the app clears the stored workspace ID, re-fetches `GET /workspaces`, selects the first, and retries the request once. QA reproduces by removing the user from a workspace server-side. |
| FR-17 | Create / rename / delete workspace controls do not exist in the app. The switcher's footer offers "Manage workspaces on the web" (handoff, FR-63). |
| FR-18 | The workspace name is visible on the record screen before recording begins, so the user knows where the meeting will land. |

### 5.3 Recording (the core)

| ID | Requirement |
|---|---|
| FR-19 | A record entry point is reachable in exactly one tap from app launch (tab bar item or persistent FAB). Time from app icon tap on a warm app to audio actually capturing, with permission already granted, is ≤ 3 seconds on iPhone 12. |
| FR-20 | On first record attempt the app presents an in-context explainer (why the mic is needed, that audio is uploaded to EchoBrief servers for processing) **before** triggering the system permission prompt. `NSMicrophoneUsageDescription` is set. |
| FR-21 | If microphone permission is denied, the record screen shows a non-blocking explanation and a button that opens `UIApplication.openSettingsURLString`. The app does not repeatedly re-prompt. |
| FR-22 | Recording captures to `.m4a` (AAC, mono, 44.1kHz, ~64kbps target) written incrementally to disk. **[Assumption]** Mono/64kbps is sufficient for AssemblyAI accuracy and keeps a 60-minute meeting at ~28MB; validate against transcription WER before locking. |
| FR-23 | The audio session uses category `.playAndRecord` with the `.mixWithOthers` / background audio capability so recording continues when the app is backgrounded or the screen is locked. QA: start a 10-minute recording, lock the phone for 8 minutes, unlock, stop — the file must contain 10 minutes of audio. |
| FR-24 | Recording state is visible outside the app: the iOS orange microphone indicator is expected, and the app displays a Live Activity **[Assumption: if a paid developer account is available; otherwise a persistent in-app banner only]**. QA fails only the in-app banner if Live Activities are descoped. |
| FR-25 | Recording survives interruptions. On an incoming phone call, Siri, or another app taking the mic, the app pauses recording, and resumes automatically when the interruption ends. The resulting file is a single continuous asset with the interruption excised. QA: record 3 min, receive a call, decline after 20s, continue to 6 min, stop → one playable file, no crash, no truncation of pre-interruption audio. |
| FR-26 | If the app is terminated (crash, force-quit, OOM) mid-recording, the partial file is recoverable. On next launch the app shows "We recovered a 12-minute recording from [time]" with Upload / Discard. QA: force-quit during recording via the debugger, relaunch, confirm recovery. |
| FR-27 | Before starting, the app checks free disk space and refuses to start with a clear message if less than 500MB is free. |
| FR-28 | Recording has a hard cap of 4 hours (matching the server's `duration_sec` max of 14400s). At 3h50m the app warns; at 4h it stops automatically and preserves the file. |
| FR-29 | While recording, the app displays elapsed time, a live input-level meter, and Pause/Resume + Stop. Stop presents a title field (pre-filled with a date/time default) and Save; Save begins upload. |

### 5.4 Processing, status, and notification-without-push

| ID | Requirement |
|---|---|
| FR-30 | After a successful upload confirm, the app schedules a local notification (`UNUserNotificationCenter`) at `estimated_seconds_remaining` from `GET /meetings/:id/status`, or 90 seconds if that field is null. **[Assumption]** Notification permission is requested at this moment, in context, not at first launch. |
| FR-31 | Before the local notification fires, and again when the app foregrounds, the app polls `GET /meetings/:id/status`. If the meeting is not yet `complete`, the pending notification is rescheduled to the new estimate. If it has `failed`, the notification copy changes to the failure state. QA must confirm no notification ever says "ready" for a meeting whose status is `failed` at fire time. |
| FR-32 | A registered `BGAppRefreshTask` polls the status of any in-flight meeting when iOS grants execution. The app functions correctly if iOS never grants it — QA must run the full flow with Background App Refresh disabled in Settings and confirm the user still learns of completion (on next foreground, FR-33). |
| FR-33 | On every foreground, the app refreshes the status of all meetings not in a terminal state and updates the list in place. Any meeting that completed while backgrounded is marked with an unread indicator in the list until opened. |
| FR-34 | Processing progress is shown as the real 4-step pipeline from `GET /meetings/:id/status` (`uploaded → transcribed → analyzed → indexed`), not an animated placeholder. Steps that did not run (e.g. `transcript_provided === true`) are hidden, not shown as skipped. |
| FR-35 | Meetings with `status: failed` display `failure_reason` verbatim plus a Retry button calling `POST /meetings/:id/retry`. Retry moves the meeting to `queued` and resumes polling. |
| FR-36 | The app never claims a completion time it cannot know. Copy is "Usually 2–5 minutes" or the server estimate, never a countdown that can run to zero while still processing. |

### 5.5 Upload

| ID | Requirement |
|---|---|
| FR-37 | Upload is a three-step sequence: `POST /meetings/upload-url` (with `filename`, `content_type`, `size`, `duration_sec`, `title`, `recorded_at`) → `PUT` the bytes to the returned R2 URL → `POST /meetings { meeting_id }` to confirm and enqueue. |
| FR-38 | `recorded_at` is set to the actual recording start time for native recordings, and to the file's creation date for imports when available. QA confirms a meeting recorded at 09:00 and uploaded at 14:00 displays 09:00 as its recorded time. |
| FR-39 | Upload uses a background `URLSession` so it continues when the app is backgrounded or terminated during transfer. |
| FR-40 | Uploads that fail retry automatically with exponential backoff (3 attempts) and, on exhaustion, remain in a visible "Waiting to upload" queue with a manual Retry. Presigned URLs expire, so a retry after expiry must re-request a fresh URL from `POST /meetings/upload-url` rather than reusing the old one. |
| FR-41 | The app never deletes a local audio file until `POST /meetings { meeting_id }` returns success. |
| FR-42 | Uploads over cellular are permitted by default, with a per-app toggle "Upload only on Wi-Fi" in Settings. When Wi-Fi-only is on and cellular is the only connection, files queue and the queue state is visible. |
| FR-43 | Upload progress (percent) is visible in the library row for the pending meeting. |
| FR-44 | Files exceeding 500MB or 4 hours are rejected client-side before presigning, with a message naming the actual limit. |

### 5.6 Import (share sheet + Files)

| ID | Requirement |
|---|---|
| FR-45 | A Share Extension declares support for audio and movie UTIs and appears in the iOS share sheet from Voice Memos, Files, Mail, Messages, and WhatsApp. |
| FR-46 | The extension presents title + workspace, then hands the file to the containing app group for upload by the main app's background session. The extension itself does not perform the upload. |
| FR-47 | An in-app "Import" action opens `UIDocumentPickerViewController` filtered to audio and movie types. |
| FR-48 | Files whose MIME type is not in the server whitelist (`audio/mpeg`, `audio/wav`, `audio/x-wav`, `audio/mp4`, `audio/m4a`, `audio/x-m4a`, `audio/webm`, `video/mp4`, `video/webm`) are transcoded client-side to `audio/m4a` via `AVAssetExportSession` before presigning. QA must successfully import `.caf`, `.aiff`, `.aac`, and `.flac` files. |
| FR-49 | If transcoding fails or the source has no audio track, the app shows "We can't read this file" naming the format, and does not create a meeting. QA fails this requirement if any unsupported file produces a raw server 400 message on screen. |
| FR-50 | Video files are stripped to an audio-only `m4a` before upload rather than uploading the full video. |
| FR-51 | Imported files are copied into app storage before processing so that a file moved or deleted in its source app mid-upload does not break the upload. |

### 5.7 Library (meetings list)

| ID | Requirement |
|---|---|
| FR-52 | The list is served from a local cache first and reconciled with `GET /meetings` when the network returns. With no network, the last-fetched list renders with a persistent "Offline — showing saved meetings" banner. |
| FR-53 | Each row shows title, recorded date (`recorded_at` falling back to `created_at`), duration, status, action-item count, participant count, and a one-line summary excerpt. |
| FR-54 | The search field maps to the `q` query parameter and debounces at 350ms. This is server-side keyword search over meetings, not semantic search — copy must not imply otherwise. |
| FR-55 | Filters expose `status` (all six values) and a date range mapping to `from`/`to`. Active filters are visible as removable chips. |
| FR-56 | The list paginates via `page`/`limit` (limit 20) with infinite scroll, and pull-to-refresh resets to page 1. |
| FR-57 | Empty states are distinct and actionable: (a) no meetings ever → record CTA; (b) no results for a filter → "Clear filters"; (c) offline with empty cache → retry. |
| FR-58 | Swipe actions on a row: Delete (with confirmation, `DELETE /meetings/:id`). Long-press → Rename (`PATCH /meetings/:id`). |

### 5.8 Meeting detail

| ID | Requirement |
|---|---|
| FR-59 | Detail is organized as segmented sections: Summary, Transcript, Actions, Speakers. All are reachable without leaving the screen. |
| FR-60 | Summary renders `executive`, `key_topics`, `decisions`, `open_questions`, and `chapters`. Every section that is null or empty is omitted entirely — no empty headers. |
| FR-61 | Tapping a chapter seeks playback to `start_sec`. |
| FR-62 | Transcript renders `segments` grouped by consecutive speaker, showing the speaker label and a timestamp. Tapping any segment seeks the player to `start_sec` and begins playback. |
| FR-63 | The transcript auto-scrolls to keep the currently-playing segment visible and highlights it. Auto-scroll suspends when the user scrolls manually and resumes via a "Jump to current" pill. |
| FR-64 | Audio playback fetches `GET /meetings/:id/audio-url` (signed, 30-minute TTL). If playback fails with a 403 the app re-requests a fresh URL once before surfacing an error. QA test: open a meeting, leave it open 35 minutes, scrub — playback must still work. |
| FR-65 | The player supports play/pause, ±15s skip, a scrubber, playback speed (1x / 1.25x / 1.5x / 2x), and continues in the background with lock-screen controls and `MPNowPlayingInfoCenter` metadata. |
| FR-66 | Meetings where `has_audio === false` (pasted-transcript meetings) render the transcript with no player and no seek affordances. |
| FR-67 | The Speakers section lists each speaker with talk-time and word count, and a talk-time share bar. Read-only. |
| FR-68 | The meeting score renders `total` plus all five components (participation, actionability, focus, clarity, efficiency) and the `explanation` string. Hidden entirely when `meeting_score` is null. |
| FR-69 | Meeting detail is cached locally after first successful load and remains fully readable offline (summary, transcript, action items, speakers, score). Audio is playable offline only for meetings recorded on this device whose local file has not yet been purged. |

### 5.9 Action items

| ID | Requirement |
|---|---|
| FR-70 | An Action Items tab lists items across all meetings via `GET /action-items`, defaulting to incomplete, grouped by meeting, with a toggle for completed. |
| FR-71 | Each item shows description, source meeting title, assignee name, and due date when present. |
| FR-72 | Tapping the checkbox toggles completion optimistically and calls `PATCH /action-items/:id { completed }`. On failure the UI reverts and shows a non-blocking error. |
| FR-73 | Toggles made offline queue locally and flush in order when connectivity returns. QA: airplane mode, toggle 5 items, restore network, confirm all 5 persist server-side. |
| FR-74 | Tapping an item's body opens its source meeting; if `timestamp_sec` is present, playback seeks there. |
| FR-75 | No edit, delete, assign, or export affordances exist on action items in 1.0. |

### 5.10 Cross-meeting search & per-meeting chat

| ID | Requirement |
|---|---|
| FR-76 | An Ask tab issues `POST /search { query, history, limit }` and renders the streamed `text/plain` response token-by-token as it arrives. |
| FR-77 | Citations are read from the `x-citations` response header (URI-encoded JSON array), which is available before the body streams, and are rendered beneath the answer as tappable cards showing meeting title, timestamp range, and excerpt. |
| FR-78 | Tapping a citation opens that meeting and seeks the player to `start_sec`. |
| FR-79 | Conversation history is held in memory for the session, capped at the server's 20-message limit, and is not persisted across app launches (matching web behavior). |
| FR-80 | Per-meeting chat is available from meeting detail via `POST /meetings/:id/chat`, using the same streaming and history rules. |
| FR-81 | The empty state offers 4 suggested prompts derived from the user's actual library **[Assumption: derived client-side from recent meeting titles; if that reads badly in testing, fall back to static prompts]**. |
| FR-82 | A stream can be cancelled mid-flight; cancelling aborts the request and keeps the partial answer on screen labeled as stopped. |
| FR-83 | With no network, the Ask tab shows "Ask needs a connection" and disables the input. It does not queue queries. |
| FR-84 | On HTTP 429 from a quota check, the app shows the server's message and a single line: "Your monthly AI query limit is used up. It resets at the start of next month." **No pricing, no plan names, no upgrade button, no link to a pricing page** — required by guideline 3.1.1. |
| FR-85 | On HTTP 429 from rate limiting (10 AI requests/minute on free tier), the app shows "Too many requests — try again in a moment" and re-enables input after the window. QA must distinguish this from FR-84. |

### 5.11 Web handoff

| ID | Requirement |
|---|---|
| FR-86 | Every OUT-but-linked feature (analytics, flashcards, workspace management, settings, share links, email generation, live transcription) is reachable from a single "More on the web" section, each row naming the specific feature. |
| FR-87 | Tapping a handoff row opens a confirmation sheet stating "This opens EchoBrief in Safari. You'll need to sign in there." then presents `SFSafariViewController` at the deep URL. |
| FR-88 | The app contains no `WKWebView` rendering EchoBrief application screens. Handoff uses `SFSafariViewController` only. (Guideline 4.2 risk mitigation.) |
| FR-89 | No handoff row, string, or URL in the binary references pricing, plans, billing, upgrading, or subscription management. QA greps the built binary's strings for "upgrade", "pricing", "plan", "subscribe", "$". |

### 5.12 Server-side additions required for 1.0

| ID | Requirement |
|---|---|
| FR-90 | Add a `source` column to `meetings` (`'web' \| 'ios_record' \| 'ios_import'`, default `'web'`), settable on `POST /meetings/upload-url`. Required to measure G1. Needs a migration plus a matching `*_rollback.sql`. |
| FR-91 | Every iOS request sends `X-Client: echobrief-ios` and `X-Client-Version: <semver>`. The API's existing request-logging middleware records both. Used for adoption and version-skew measurement. |
| FR-92 | `POST /meetings/upload-url` and `POST /meetings` must be idempotent enough that a background-session retry of a confirm call for an already-confirmed meeting returns 200, not a 409/500. QA: force a duplicate confirm and confirm no duplicate meeting row and no error surfaced. |

---

## 6. Non-functional requirements

### 6.1 Performance budgets

| Metric | Target | How measured |
|---|---|---|
| Cold start → meetings list rendered (cached) | ≤ 1.5s p50, ≤ 2.5s p95 on iPhone 12 | Instruments App Launch template, 10 runs |
| Warm start → recording capturing audio | ≤ 3.0s including permission already granted | Manual stopwatch, 10 runs, RC checklist |
| Meetings list scroll | 60fps sustained; no frame > 16.6ms during a 200-row fling | Instruments Animation Hitches, hitch ratio < 1% |
| Meeting detail open (cached) | ≤ 400ms to content | Signpost timing |
| Transcript render, 90-minute meeting (~3,000 segments) | Initial paint ≤ 800ms; must use a lazy/virtualized list | Instruments; QA with a real 90-min meeting |
| Chat/search time-to-first-token | ≤ 2.5s p50, ≤ 6s p95 | Client-side signpost from request start to first byte of body. **Server-bound — the app is responsible only for not adding overhead beyond 150ms.** |
| Memory, 90-minute transcript + playback | < 250MB resident | Instruments Allocations |
| Battery, 60-minute background recording | ≤ 8% of a full iPhone 12 charge | Xcode Energy gauge, 3 runs |
| App binary size | ≤ 40MB download | App Store Connect report |

### 6.2 Offline behavior

| State | Behavior |
|---|---|
| No network, app launch with valid cached token | Library renders from cache; offline banner; no forced sign-in |
| No network, recording | Fully functional. Recording never touches the network. |
| No network, upload pending | File held on disk, visible in queue, auto-uploads on reconnect |
| No network, meeting detail previously opened | Full read: summary, transcript, action items, speakers, score |
| No network, meeting detail never opened | Explicit "Not downloaded yet" state, not a spinner |
| No network, audio playback | Only for locally-recorded files not yet purged; otherwise explicit |
| No network, action item toggle | Optimistic + queued; flushed in order on reconnect |
| No network, Ask / chat | Disabled with explanation. Never queued. |
| Flaky network (Network Link Conditioner "Very Bad Network") | No crashes, no infinite spinners; every request has a 30s timeout and a retry affordance |

Cache policy: meeting metadata and transcripts cached indefinitely, evicted LRU above 200MB. Locally recorded audio purged 7 days after its meeting reaches `complete`, or immediately on user request.

### 6.3 Accessibility

| Requirement | Acceptance |
|---|---|
| VoiceOver | Every interactive element has a label and, where non-obvious, a hint. A blind QA pass must complete: sign in → record 30s → stop → save → find the meeting → read the summary → toggle an action item. |
| VoiceOver, transcript | Each segment is a single element announced as "[Speaker], at [mm:ss], [text]". Tapping activates seek. Not a wall of unstructured text. |
| VoiceOver, recording | Recording start, pause, resume, and stop are announced via `UIAccessibility.post(notification: .announcement)`. Elapsed time is available on demand, not announced continuously. |
| Dynamic Type | All text uses semantic text styles and scales to AX3 without clipping or truncation. QA screenshots every screen at the default size and at AX3. |
| Reduce Motion | Honors `UIAccessibility.isReduceMotionEnabled`: no parallax, no spring transitions, cross-dissolve only. The live-recording level meter becomes a static state indicator. |
| Contrast | All text ≥ 4.5:1 against its background in both light and dark appearance. The recording indicator does not rely on color alone (icon + text). |
| Tap targets | ≥ 44×44pt for every control, explicitly including the transcript seek rows and the action item checkbox. |
| Dark mode | Full support; both appearances screenshotted in RC. |
| Reduce Transparency / Increase Contrast | No unreadable surfaces. |

### 6.4 Security

| Requirement | Detail |
|---|---|
| Token storage | Keychain, `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, not synced to iCloud Keychain. Never in `UserDefaults`, plists, or logs. |
| No secrets in bundle | The binary contains only the API base URL. No API keys (OpenAI, AssemblyAI, R2, Sentry DSN excepted as it is public-by-design), no `AUTH_SECRET`, no service credentials. Enforced by a Gitleaks run over the iOS repo in CI. |
| Transport | ATS enforced, no exceptions in `Info.plist`. HTTPS only. Certificate pinning deliberately **not** implemented in 1.0 — it breaks silently on cert rotation and Railway's cert lifecycle is not under our control. Documented as an accepted risk. |
| Presigned URLs | Treated as secrets: never logged, never persisted, never included in crash reports. |
| Local audio at rest | Stored in the app container with `.completeUntilFirstUserAuthentication` file protection. |
| Local cache at rest | Transcripts and summaries stored with the same protection class and purged on sign-out and on account deletion. |
| Logging | No transcript text, summary text, chat message, email address, or token is written to `os_log` at any level in a Release build. QA inspects a Release-build Console stream during a full flow. |
| Crash reporting | If Sentry is enabled, `beforeSend` scrubs request bodies, headers, and any `MeetingDetail` payloads. Default off until OQ-5 is decided. |
| Pasteboard | Copying transcript text uses a non-universal pasteboard item so it does not sync to other devices via Handoff. |

### 6.5 Privacy — App Privacy nutrition label answers

| Data type | Collected | Linked to identity | Used for tracking | Purpose |
|---|---|---|---|---|
| Email address | Yes | Yes | No | App functionality (account) |
| Name (optional) | Yes | Yes | No | App functionality |
| Audio recordings | Yes | Yes | No | App functionality (transcription) |
| Transcripts / summaries / action items (User Content) | Yes | Yes | No | App functionality |
| User ID | Yes | Yes | No | App functionality |
| Crash data / performance | Yes, if Sentry enabled | **No** | No | App functionality (diagnostics) |
| Precise or coarse location | No | — | — | — |
| Contacts | No | — | — | — |
| Advertising identifiers | No | — | — | — |

Additional privacy requirements:

| ID | Requirement |
|---|---|
| NFR-P1 | No ATT prompt. The app performs no tracking and links to no data broker or ad network. |
| NFR-P2 | The first-run recording explainer states plainly: audio is uploaded to EchoBrief servers, processed by third-party AI providers (AssemblyAI for transcription, OpenAI for summarization), and retained until the user deletes the meeting. |
| NFR-P3 | The same screen carries a recording-consent notice: "Recording laws vary. Make sure everyone in the room knows they're being recorded." This is a legal-exposure mitigation, not a compliance claim. |
| NFR-P4 | `PrivacyInfo.xcprivacy` manifest declares all required-reason APIs used (file timestamps, disk space, `UserDefaults`) with correct reason codes. Required for App Store submission. |
| NFR-P5 | Account deletion (FR-10) removes server-side data via the existing endpoint and purges every local artifact including cached audio. |
| NFR-P6 | No data leaves the device before sign-in. QA verifies with a proxy that a fresh install issues zero network requests until the user taps Sign in or Sign up. |

---

## 7. Success metrics

**There is no analytics SDK in this product today, and 1.0 does not add one.** Everything below is measured from the existing Postgres schema plus the two additions in FR-90/FR-91, or it is not measured at all — and where it is not measurable, this section says so rather than inventing a number nobody can check.

### Activation

| Metric | Target | Measurement |
|---|---|---|
| A1 — % of iOS sign-ups that create their first meeting within 24h | ≥ 50% | SQL: join `users.created_at` to the first `meetings.created_at` where `meetings.source LIKE 'ios_%'` |
| A2 — % of first iOS meetings created by the recorder (vs import) | ≥ 60% | `meetings.source` distribution (FR-90) |
| A3 — Median time from install to first recording | ≤ 10 minutes | App Store Connect install date is not user-joinable, so this is approximated as sign-up → first `ios_record` meeting. **Install-to-signup is not measurable without an SDK.** |
| A4 — % of first recordings that reach `status: complete` | ≥ 95% | `meetings` status distribution filtered to `source = 'ios_record'` |

### Retention

| Metric | Target | Measurement |
|---|---|---|
| R1 — Week-1 retention (a second iOS-sourced meeting or an iOS API request in days 2–7) | ≥ 40% | `X-Client` header logged by request middleware (FR-91), aggregated per user per day |
| R2 — Week-4 retention | ≥ 25% | Same |
| R3 — Meetings per active iOS user per week | ≥ 2.0 | `meetings` count where `source LIKE 'ios_%'` / weekly actives |
| R4 — % of a user's total meetings that come from iOS, at day 30 | ≥ 40% (this is G1) | `meetings.source` per user |

### Feature-level

| Metric | Target | Measurement |
|---|---|---|
| F1 — % of completed iOS meetings opened by their owner within 24h | ≥ 90% (this is G4, the push-substitute test) | **Not measurable server-side today** — a `GET /meetings/:id` from an iOS client is a proxy but conflates polling with viewing. Requires either an explicit "viewed" write or accepting the proxy. Flagged as OQ-4. |
| F2 — Ask (cross-meeting search) usage: % of iOS WAU issuing ≥ 1 query per week | ≥ 30% | `usage_logs.ai_queries_count` joined to requests carrying the iOS `X-Client` header |
| F3 — Action items completed from iOS per week | ≥ 3 per active user | `action_items.completed_at` correlated to iOS-client `PATCH` requests |
| F4 — Import (share sheet + Files) adoption | ≥ 25% of iOS users use it at least once in 30 days | `meetings.source = 'ios_import'` |
| F5 — Upload failure rate (uploads that never reach `confirm`) | < 2% | **Not measurable server-side** — a failed upload leaves an orphan `meetings` row in a pre-`queued` state; counting those over presign requests is the best available proxy. |
| F6 — Recording data-loss incidents | 0 | Support reports only. There is no telemetry for this and there should not be an incident to count. |
| F7 — Crash-free sessions | ≥ 99.5% | App Store Connect Metrics (free, no SDK) |

### What we deliberately cannot measure in 1.0

Permission-denial rate, record-button-tap-to-start funnel, screen-level drop-off, time-to-first-token distribution in the wild, share-extension abandonment, and any client-side error that never reaches the server. Adding a privacy-respecting analytics layer (TelemetryDeck or self-hosted PostHog, already on the backend roadmap) is the first item in §11 for a reason.

---

## 8. Release criteria

1.0 does not ship unless every line is checked.

**Correctness & data integrity**

- [ ] RC-1 — Full happy path passes on iPhone SE (3rd gen), iPhone 12, iPhone 15 Pro: sign up → record 5 min → save → upload → complete → read summary → play audio → tap transcript to seek → toggle an action item → ask a cross-meeting question → tap a citation.
- [ ] RC-2 — 4-hour recording completes, uploads, and processes without truncation or OOM.
- [ ] RC-3 — Backgrounded and screen-locked recording verified for ≥ 30 continuous minutes.
- [ ] RC-4 — Phone-call interruption test (FR-25) passes 3/3.
- [ ] RC-5 — Force-quit-during-recording recovery (FR-26) passes 3/3.
- [ ] RC-6 — Upload survives app termination mid-transfer via background `URLSession`.
- [ ] RC-7 — Airplane-mode matrix from §6.2 fully executed; no crash, no infinite spinner, no data loss.
- [ ] RC-8 — Expired-token (401) mid-upload test (FR-7) passes with zero data loss.
- [ ] RC-9 — **Zero recording-loss defects open.** Any bug that can lose a recording is a ship blocker regardless of severity rating.
- [ ] RC-10 — Import verified from Voice Memos, Files, WhatsApp, Mail, and AirDrop, including `.caf`, `.aiff`, `.aac`, `.flac`, and an `.mp4` video.

**Performance**

- [ ] RC-11 — Every §6.1 budget met on iPhone 12 with a 100-meeting library including one 90-minute meeting.
- [ ] RC-12 — Instruments shows no retain cycles or leaks across a 20-minute session including recording and playback.

**Accessibility**

- [ ] RC-13 — Full VoiceOver pass (§6.3) completed by someone who did not build the feature.
- [ ] RC-14 — AX3 Dynamic Type screenshots of every screen show no clipping or truncation.
- [ ] RC-15 — Reduce Motion verified on every animated transition.
- [ ] RC-16 — Contrast audit passes 4.5:1 on all text in both appearances.

**Security & privacy**

- [ ] RC-17 — Keychain storage verified; no token in `UserDefaults`, files, or logs.
- [ ] RC-18 — Release-build Console stream contains no transcript, summary, email, or token text.
- [ ] RC-19 — Gitleaks clean on the iOS repo; binary `strings` contains no credentials.
- [ ] RC-20 — Proxy capture confirms zero network traffic before sign-in.
- [ ] RC-21 — `PrivacyInfo.xcprivacy` complete; App Privacy answers in App Store Connect match §6.5 exactly.

**App Store readiness**

- [ ] RC-22 — No third-party sign-in control anywhere in the binary (4.8).
- [ ] RC-23 — Binary `strings` search for pricing/plan/upgrade/subscribe/`$` returns nothing user-facing (3.1.1).
- [ ] RC-24 — In-app account deletion works end-to-end (5.1.1(v)).
- [ ] RC-25 — No `WKWebView` renders EchoBrief app screens (4.2).
- [ ] RC-26 — Demo account provisioned for App Review, pre-loaded with 5 completed meetings so reviewers do not have to wait on the pipeline. Credentials in the review notes.
- [ ] RC-27 — Review notes explain that recording produces real value in-app and that the web handoff covers desktop-only administration.
- [ ] RC-28 — All required-reason API declarations present; app passes App Store Connect validation.

**Operational**

- [ ] RC-29 — Migration for `meetings.source` (FR-90) applied to production with its rollback script tested.
- [ ] RC-30 — Backend load-checked for the added polling volume: N in-flight meetings × one poll / 5s / user, against the free-tier `general` rate limit of 100 req/min. Confirm the mobile polling cadence cannot rate-limit a normal user.
- [ ] RC-31 — TestFlight build run for ≥ 7 days by ≥ 5 external testers with zero P0/P1 open.

---

## 9. Risks & mitigations

Ranked by expected cost (probability × impact).

| # | Risk | Likelihood | Impact | Mitigation / owner action |
|---|---|---|---|---|
| R1 | **Recording data loss** — interruption, termination, disk exhaustion, or an upload bug destroys a meeting the user cannot re-create. | Medium | Catastrophic (product trust is binary) | Engineering: incremental write-to-disk (FR-22), crash recovery (FR-26), never delete before confirm (FR-41), disk pre-check (FR-27). QA: RC-2..RC-9 are hard blockers. |
| R2 | **App Store rejection under 4.2** — reviewer judges the app a wrapper. | Medium | High (weeks of delay) | Product: lead the review notes with native recording, background capture, share extension, and offline reading. Ensure the demo account has real content (RC-26). Never render app screens in a `WKWebView` (FR-88). |
| R3 | **Rejection under 5.1.1(v)** — no in-app account deletion. | High if descoped | High | Product: overrule the original scope and ship FR-10. Non-negotiable. |
| R4 | **No push makes the async pipeline feel broken** — user records, leaves, never learns it finished. | High | Medium-High | Engineering: local notification + reschedule + background refresh + foreground reconciliation (FR-30..FR-33). Product: buy the developer account and put APNs at the top of 1.1. |
| R5 | **Free-tier AI quota (10/month) burns out the flagship feature in one session**, and 3.1.1 forbids us from explaining the fix commercially. | High | Medium | Product: FR-84 copy must be honest and non-commercial. Consider (with Business) a one-time mobile-onboarding grant of additional queries — server-side, invisible to the app, no IAP implication. Raised as OQ-2. |
| R6 | **Import format failures** — share-sheet sources produce formats the server whitelist rejects. | High without FR-48 | Medium | Engineering: client-side transcode to `m4a` (FR-48), explicit failure copy (FR-49). QA: RC-10. |
| R7 | **Transcription quality degrades from phone-mic room audio** — far-field, multi-speaker, echo. Summaries built on a bad transcript look like a broken product. | Medium-High | High | Engineering: validate WER at the FR-22 encoding settings against a real conference-room recording before locking. Product: if quality is poor, add an in-app "place the phone near the speaker" tip and consider raising the bitrate. This is the biggest un-de-risked assumption in the release. |
| R8 | **7-day JWT with no refresh** forces weekly re-login and can strand an upload. | Certain (by design) | Medium | Engineering: FR-7 guarantees no data loss. Product: OQ-1 — decide whether to add a refresh endpoint before or after 1.0. |
| R9 | **Battery drain from background recording** generates 1-star reviews. | Medium | Medium | Engineering: mono/64kbps, no live waveform processing while backgrounded, energy budget in RC-11. |
| R10 | **Polling volume trips the rate limiter** — several in-flight meetings plus normal browsing exceeds 100 req/min on free tier. | Low-Medium | Medium | Engineering: single consolidated poll loop with backoff, never per-meeting timers. Verify in RC-30. |
| R11 | **Handoff re-login seam** makes the app feel half-finished during a portfolio demo. | High | Low-Medium | Product: honest confirmation copy (FR-87); one-time handoff token in 1.1 (OQ-3). |
| R12 | **90-minute transcripts blow the memory or scroll budget.** | Medium | Medium | Engineering: virtualized list, segment coalescing, RC-11 with a real long meeting. |
| R13 | **Signed audio URL expires mid-session** (30-min TTL) and playback dies silently. | Medium | Low | Engineering: FR-64 refresh-on-403. QA: the 35-minute test. |
| R14 | **Recording-consent legal exposure** in two-party-consent jurisdictions. | Low | High if realized | Product/Legal: NFR-P3 disclosure; Terms updated to place responsibility on the recorder. Not a compliance guarantee — needs counsel review. |
| R15 | **Cert rotation breaks the app** if pinning is added late. | Low | High | Decision recorded: no pinning in 1.0 (§6.4). Do not add it without a rotation runbook. |

---

## 10. Open questions

| # | Question | Why it needs a human | Blocking? |
|---|---|---|---|
| OQ-1 | Do we add a token-refresh endpoint before 1.0? A 7-day expiry with no refresh means a weekly forced re-login on a device people expect to stay signed in. FR-7 makes it safe but not pleasant. | Backend scope decision with a security tradeoff (refresh tokens need revocation and storage). | No, but affects retention |
| OQ-2 | Can we grant new iOS users a one-time allowance of additional AI queries server-side, so the flagship feature is not exhausted in the first session? Does that create any 3.1.1 exposure? | Business/pricing decision, plus an App Review judgment call. My read: a server-side grant the app never mentions is not IAP-adjacent, but it should be confirmed. | No |
| OQ-3 | Do we build a one-time handoff-token endpoint (`POST /auth/handoff` → short-lived single-use token → web URL that signs the session in) so web handoff does not require re-login? | New auth surface; needs a security review. Meaningful demo-quality improvement. | No |
| OQ-4 | How do we measure "user actually read the meeting" (metric F1) without an analytics SDK? Options: an explicit `POST /meetings/:id/viewed`, infer from `GET /meetings/:id` with an iOS client header, or accept the metric is unmeasurable in 1.0. | Product decision about instrumentation cost vs. measurement fidelity. | No |
| OQ-5 | Do we ship Sentry in the iOS app? It gives crash context but adds a dependency, a privacy-label entry, and a PII-scrubbing burden. App Store Connect Metrics gives crash-free rate for free. | Privacy vs. debuggability tradeoff. | No |
| OQ-6 | Is the paid Apple Developer account ($99/yr) purchased, and when? It gates App Store distribution entirely, plus Live Activities (FR-24) and any future push. | Budget decision. If the answer is "no", 1.0 is a TestFlight/simulator artifact and half of §8 (App Store readiness) becomes hypothetical. | **Yes — blocks the release definition itself** |
| OQ-7 | What is the acceptable transcription quality floor for phone-recorded room audio (R7)? We need a measured WER on a real conference-room sample before locking FR-22's encoding. Who runs that test and against what benchmark? | Requires a real recording and a judgment call about what quality is shippable. | **Yes — blocks FR-22** |
| OQ-8 | Should the student account kind see anything different on iOS at all? Right now a student signing in gets the professional app minus flashcards, which may read as a downgrade from web. | Segmentation decision. | No |
| OQ-9 | Retention policy for locally-recorded audio: the proposed 7-day-after-complete purge could delete a file a user still wanted offline. Is 7 days right, or should it be user-configurable? | Storage vs. utility tradeoff. | No |
| OQ-10 | Does the recording-consent notice (NFR-P3) need legal review before submission, given the app is a portfolio project and not an operating business? | Legal exposure judgment. | No |

---

## 11. Out-of-scope roadmap

Ordered by expected value per unit of effort, not by ambition.

### 1.1 — "Close the loops 1.0 left open"

| # | Item | Why it is first |
|---|---|---|
| 1 | **Push notifications (APNs)** — device-token table, server-side sender in the worker's completion path, notification on `complete` and on `failed` | Retires the largest UX debt in 1.0 (R4). Everything about the async pipeline gets better at once. Requires OQ-6 resolved. |
| 2 | **Privacy-respecting analytics** (TelemetryDeck or self-hosted PostHog) | Until this ships, half of §7 is unmeasurable and every subsequent prioritization decision is a guess. |
| 3 | **Speaker renaming** (`POST /meetings/:id/speakers`) | Endpoint exists; unnamed A/B/C speakers are the single worst thing about reading a transcript on a small screen. |
| 4 | **Action item editing** — description, assignee, due date | Persona 3's most likely complaint from 1.0. Endpoint exists. |
| 5 | **One-time web handoff token** (OQ-3) | Removes the re-login seam from every handoff row. |
| 6 | **Token refresh** (OQ-1) | Removes the weekly re-login. |
| 7 | **iPad layout** | Cheap in SwiftUI once the phone layout is stable; transcript + player is genuinely better on a larger screen. |

### 1.2 — "Make the capture device smarter"

| # | Item | Why it comes second |
|---|---|---|
| 1 | **Live streaming transcription** (AssemblyAI streaming, already built for web) | High demo value, high battery/network cost, and it needs 1.1's push and analytics to be evaluated honestly. Only worth building once we know from data that people record long meetings on the phone. |
| 2 | **Widgets + Live Activity** — a Home Screen "Record" widget and a Dynamic Island recording state | Cuts time-to-record below 3 seconds, which is the metric that matters most for G1. |
| 3 | **Siri / App Intents** — "Hey Siri, record a meeting in EchoBrief" | Same job; note the platform constraint that a *recording* cannot start from the background without user-initiated foreground activation, so this launches the app rather than starting silently. |
| 4 | **Share links** (create + revoke from mobile) | Once the app is trusted, sharing a summary from a phone is a natural follow-through action. |
| 5 | **StoreKit 2 subscriptions** | Only worth the 3.1.1 complexity when there is real mobile-driven conversion to capture. Requires reconciling Apple's 15–30% cut with the existing web pricing. |
| 6 | **Flashcards / study mode** | Serves the secondary persona. Deserves its own design pass, not a port. |
| 7 | **Analytics dashboard (mobile-shaped)** | Not the web charts — a small set of glanceable stats. Low value; last. |

### Explicitly not on the roadmap

Calendar auto-join bots, real-time collaborative transcript editing, Android (until iOS proves the capture thesis), and on-device transcription (the quality gap versus AssemblyAI is not worth the battery, and it would fragment the pipeline).
