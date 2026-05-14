# EchoBrief AI — Use Cases Document

**Version:** 1.0  
**Author:** Suhaas NV  
**Last Updated:** 2026-05-14  
**Status:** Active

This document defines all use cases for EchoBrief across all versions. Each use case describes who does what, under what conditions, what the system does, and what success and failure look like.

---

## Table of Contents

### Authentication
- [UC-01: Sign Up with Email](#uc-01-sign-up-with-email)
- [UC-02: Sign Up with Google](#uc-02-sign-up-with-google)
- [UC-03: Log In](#uc-03-log-in)
- [UC-04: Log Out](#uc-04-log-out)
- [UC-05: Reset Password](#uc-05-reset-password)
- [UC-06: Delete Account](#uc-06-delete-account)

### Meeting Processing
- [UC-07: Upload Audio File](#uc-07-upload-audio-file)
- [UC-08: Monitor Processing Status](#uc-08-monitor-processing-status)
- [UC-09: Retry Failed Processing](#uc-09-retry-failed-processing)
- [UC-10: Cancel Upload in Progress](#uc-10-cancel-upload-in-progress)

### Meeting Management
- [UC-11: Browse Meetings List](#uc-11-browse-meetings-list)
- [UC-12: Search Meetings by Keyword](#uc-12-search-meetings-by-keyword)
- [UC-13: Filter Meetings](#uc-13-filter-meetings)
- [UC-14: Rename a Meeting](#uc-14-rename-a-meeting)
- [UC-15: Tag a Meeting](#uc-15-tag-a-meeting)
- [UC-16: Delete a Meeting](#uc-16-delete-a-meeting)
- [UC-17: Share a Meeting via Public Link](#uc-17-share-a-meeting-via-public-link)

### Transcript
- [UC-18: Read a Meeting Transcript](#uc-18-read-a-meeting-transcript)
- [UC-19: Search Within a Transcript](#uc-19-search-within-a-transcript)
- [UC-20: Navigate Transcript via Timestamp](#uc-20-navigate-transcript-via-timestamp)
- [UC-21: Edit Transcript (Correction)](#uc-21-edit-transcript-correction) *(V2)*
- [UC-22: Rename a Speaker](#uc-22-rename-a-speaker) *(V2)*

### AI Summary
- [UC-23: View AI-Generated Summary](#uc-23-view-ai-generated-summary)
- [UC-24: Copy Summary to Clipboard](#uc-24-copy-summary-to-clipboard)
- [UC-25: Regenerate Summary](#uc-25-regenerate-summary)

### Action Items
- [UC-26: View Action Items from a Meeting](#uc-26-view-action-items-from-a-meeting)
- [UC-27: Complete an Action Item](#uc-27-complete-an-action-item)
- [UC-28: Edit an Action Item](#uc-28-edit-an-action-item)
- [UC-29: Reassign an Action Item](#uc-29-reassign-an-action-item)
- [UC-30: View All Action Items (Dashboard)](#uc-30-view-all-action-items-dashboard)
- [UC-31: Export Action Item to Notion](#uc-31-export-action-item-to-notion) *(V2)*
- [UC-32: Export Action Item to Linear](#uc-32-export-action-item-to-linear) *(V2)*

### AI Chat (Per-Meeting)
- [UC-33: Ask a Question About a Meeting](#uc-33-ask-a-question-about-a-meeting)
- [UC-34: Follow Up on a Chat Answer](#uc-34-follow-up-on-a-chat-answer)
- [UC-35: Navigate to Source Timestamp from Chat Answer](#uc-35-navigate-to-source-timestamp-from-chat-answer)

### AI Chat (Cross-Meeting)
- [UC-36: Ask a Question Across All Meetings](#uc-36-ask-a-question-across-all-meetings)
- [UC-37: Use a Suggested Query](#uc-37-use-a-suggested-query)
- [UC-38: Navigate to Source Meeting from Search Answer](#uc-38-navigate-to-source-meeting-from-search-answer)

### Analytics
- [UC-39: View Dashboard Stats](#uc-39-view-dashboard-stats)
- [UC-40: View Meeting Frequency Chart](#uc-40-view-meeting-frequency-chart)
- [UC-41: View Meeting Score](#uc-41-view-meeting-score) *(V2)*
- [UC-42: View Speaker Participation Stats](#uc-42-view-speaker-participation-stats) *(V2)*
- [UC-43: Filter Analytics by Date Range](#uc-43-filter-analytics-by-date-range)

### Integrations (V2)
- [UC-44: Connect a Notion Integration](#uc-44-connect-a-notion-integration)
- [UC-45: Disconnect an Integration](#uc-45-disconnect-an-integration)
- [UC-46: Generate Follow-Up Email](#uc-46-generate-follow-up-email)

### Settings
- [UC-47: Update Profile Information](#uc-47-update-profile-information)
- [UC-48: Change Password](#uc-48-change-password)
- [UC-49: Manage Notification Preferences](#uc-49-manage-notification-preferences)
- [UC-50: Export Personal Data (GDPR)](#uc-50-export-personal-data-gdpr)

### Team & Collaboration (V3)
- [UC-51: Create a Workspace](#uc-51-create-a-workspace)
- [UC-52: Invite a Team Member](#uc-52-invite-a-team-member)
- [UC-53: Accept Workspace Invitation](#uc-53-accept-workspace-invitation)
- [UC-54: Remove a Team Member](#uc-54-remove-a-team-member)
- [UC-55: Comment on a Transcript Section](#uc-55-comment-on-a-transcript-section)
- [UC-56: Start a Live Transcription Session](#uc-56-start-a-live-transcription-session)

---

## Use Case Format

Each use case follows this structure:

- **Actor** — who initiates the action
- **Trigger** — what starts the use case
- **Preconditions** — what must be true before it runs
- **Main Flow** — the happy path, step by step
- **Alternate Flows** — valid variations of the main path
- **Exception Flows** — error conditions and how they're handled
- **Postconditions** — what is true after success
- **Version** — V1, V2, or V3

---

## Authentication

---

### UC-01: Sign Up with Email

**Actor:** Unauthenticated visitor  
**Trigger:** User clicks "Get started" or navigates to `/signup`  
**Preconditions:** User does not have an existing account  
**Version:** V1

**Main Flow:**
1. User opens `/signup`
2. User enters name, email, password
3. User clicks "Create account"
4. System validates input (format, uniqueness)
5. System creates user record in Supabase Auth
6. System sends email verification link
7. System creates session and redirects user to `/app/`
8. Dashboard shows empty state with onboarding prompt

**Alternate Flows:**
- A1: User skips email verification — can still use the app; unverified banner shown
- A2: User switches to Google sign-in mid-flow — see UC-02

**Exception Flows:**
- E1: Email already registered → show "An account with this email already exists. [Log in instead]"
- E2: Weak password → inline error: "Password must be at least 8 characters with one number"
- E3: Network error → toast: "Could not create account. Please try again."

**Postconditions:**
- User record created in `users` table
- Supabase Auth session active
- User redirected to dashboard

---

### UC-02: Sign Up with Google

**Actor:** Unauthenticated visitor  
**Trigger:** User clicks "Sign in with Google"  
**Preconditions:** None  
**Version:** V1

**Main Flow:**
1. User clicks Google sign-in button
2. Browser redirects to Google OAuth consent screen
3. User grants permission
4. Google redirects to Supabase OAuth callback URL
5. Supabase issues session JWT
6. If new user: creates record in `users` table with Google profile data
7. If returning user: updates last login
8. Redirect to `/app/`

**Exception Flows:**
- E1: User denies Google permission → returns to `/signup` with no error (user simply cancelled)
- E2: Google OAuth error → toast: "Google sign-in failed. Try email instead."

---

### UC-03: Log In

**Actor:** Registered user  
**Trigger:** User navigates to `/login` or is redirected from a protected route  
**Preconditions:** User has an existing account  
**Version:** V1

**Main Flow:**
1. User enters email and password
2. User clicks "Sign in"
3. System validates credentials via Supabase Auth
4. System issues session JWT stored in httpOnly cookie
5. System redirects to: originally requested URL → `/app/` (if no prior destination)

**Alternate Flows:**
- A1: User clicks "Sign in with Google" → UC-02
- A2: User clicks "Forgot password" → UC-05

**Exception Flows:**
- E1: Invalid credentials → "Invalid email or password" (generic — don't confirm which field is wrong)
- E2: Account locked (too many attempts) → "Too many attempts. Try again in 15 minutes."
- E3: Network error → "Could not connect. Check your connection."

---

### UC-04: Log Out

**Actor:** Authenticated user  
**Trigger:** User clicks avatar → "Log out" in dropdown  
**Preconditions:** User is logged in  
**Version:** V1

**Main Flow:**
1. User clicks "Log out"
2. System invalidates session (Supabase Auth signOut)
3. System clears httpOnly cookie
4. System redirects to `/login`

**Exception Flows:**
- E1: Network error during signout → clear local session anyway, redirect to `/login`

---

### UC-05: Reset Password

**Actor:** Unauthenticated user  
**Trigger:** User clicks "Forgot password?" on login page  
**Preconditions:** User has an account  
**Version:** V1

**Main Flow:**
1. User enters email on `/forgot-password`
2. User clicks "Send reset link"
3. System sends password reset email via Supabase Auth
4. Screen shows: "Check your email for a reset link"
5. User clicks link in email → opens `/reset-password?token=...`
6. User enters and confirms new password
7. System updates password, creates new session
8. User redirected to `/app/`

**Exception Flows:**
- E1: Email not in system → still show "Check your email" (prevent user enumeration)
- E2: Token expired (> 1 hour) → "Link expired. Request a new one." + CTA

---

### UC-06: Delete Account

**Actor:** Authenticated user  
**Trigger:** User goes to Settings → Danger Zone → "Delete account"  
**Preconditions:** User is logged in  
**Version:** V1

**Main Flow:**
1. User clicks "Delete account"
2. Confirmation modal: "This will permanently delete all your meetings, transcripts, and data."
3. User types "DELETE" to confirm
4. System queues: delete all R2 audio files, delete all DB records (cascade), delete auth record
5. System logs user out
6. Redirects to landing page with message: "Your account has been deleted."

**Exception Flows:**
- E1: User types wrong confirmation text → delete button stays disabled
- E2: Deletion fails mid-way → partial data remains, support ticket created automatically

---

## Meeting Processing

---

### UC-07: Upload Audio File

**Actor:** Authenticated user  
**Trigger:** User navigates to `/app/upload`  
**Preconditions:** User is logged in; file is ≤ 500MB and in supported format  
**Version:** V1

**Main Flow:**
1. User drags file onto drop zone (or clicks "Browse files")
2. Client validates file type and size
3. Client displays file card with name, size, detected duration
4. User fills in meeting title (auto-populated from filename if possible), date, language, tags
5. User clicks "Upload and process"
6. Client requests presigned R2 URL from API
7. API creates meeting record (`status=queued`), returns `{ upload_url, meeting_id }`
8. Client uploads file directly to R2 in 5MB chunks with progress bar
9. Client confirms upload complete to API
10. API pushes job to Cloudflare Queue
11. Client redirects to Processing Status screen (S-08) for this meeting

**Alternate Flows:**
- A1: User drops file, decides to change it → clicks × on file card, drop zone reappears
- A2: Upload paused (tab backgrounded on mobile) → resumes when tab returns to foreground

**Exception Flows:**
- E1: File type unsupported → red border on drop zone: "Unsupported format. Accepted: MP3, WAV, M4A, MP4, WEBM"
- E2: File > 500MB → "File too large. Maximum size is 500MB."
- E3: Network drops during upload → retry last failed chunk automatically (up to 3 times), then show: "Upload paused. [Retry]"
- E4: API returns error on presigned URL request → "Could not start upload. Please try again."

**Postconditions:**
- Audio file stored in R2 at `{user_id}/{meeting_id}/original.{ext}`
- Meeting record in DB with `status=queued`
- Job in Cloudflare Queue

---

### UC-08: Monitor Processing Status

**Actor:** Authenticated user  
**Trigger:** Automatic redirect after upload completes; or user navigates to a meeting with non-complete status  
**Preconditions:** Meeting record exists with status ≠ complete  
**Version:** V1

**Main Flow:**
1. Screen shows pipeline steps: Uploaded → Transcribing → Analyzing → Indexing
2. Client polls `GET /api/v1/meetings/:id/status` every 5 seconds
3. Each step updates as it transitions (waiting → in-progress → complete)
4. Estimated time remaining shown based on audio duration
5. When status = complete: success animation plays
6. Auto-redirects to Meeting Detail in 2 seconds

**Alternate Flows:**
- A1: User closes tab → email sent on completion (if "Notify me" was toggled)
- A2: User uploads another file while waiting → new upload starts; polling continues for both

**Exception Flows:**
- E1: Status = failed → show which step failed: "Transcription failed. [Retry]"
- E2: Polling API unavailable → show last known status, retry polling after 30 seconds

---

### UC-09: Retry Failed Processing

**Actor:** Authenticated user  
**Trigger:** Processing status shows "Failed"; user clicks "Retry"  
**Preconditions:** Meeting exists with `status=failed`  
**Version:** V1

**Main Flow:**
1. User clicks "Retry" on the failed meeting
2. API resets meeting status to `queued` and re-queues job
3. UI transitions back to processing status view
4. Pipeline runs from the failed step (not from the beginning)

**Exception Flows:**
- E1: Audio file was deleted from R2 → "Audio file no longer available. Please re-upload."
- E2: Retry limit reached (3 retries) → "Processing failed after multiple attempts. [Contact support]"

---

### UC-10: Cancel Upload in Progress

**Actor:** Authenticated user  
**Trigger:** User clicks "Cancel" during file upload  
**Preconditions:** Upload is actively in progress  
**Version:** V1

**Main Flow:**
1. User clicks "Cancel"
2. Confirmation: "Cancel upload? The file will not be processed."
3. User confirms
4. Client aborts the in-progress R2 upload
5. API deletes the partially created meeting record
6. UI returns to idle upload screen

**Exception Flows:**
- E1: Upload already completed before cancel processed → meeting record exists; treat as normal meeting, show success

---

## Meeting Management

---

### UC-11: Browse Meetings List

**Actor:** Authenticated user  
**Trigger:** User navigates to `/app/meetings`  
**Preconditions:** User is logged in  
**Version:** V1

**Main Flow:**
1. Page loads with most recent meetings first (20 per page)
2. Each row shows: title, date, duration, participant count, tag chips, status chip, action item count, snippet of summary
3. User can scroll and paginate

**Alternate Flows:**
- A1: No meetings → empty state: illustration + "Upload your first meeting"
- A2: User has > 20 meetings → pagination controls appear

---

### UC-12: Search Meetings by Keyword

**Actor:** Authenticated user  
**Trigger:** User types in the search bar on `/app/meetings`  
**Preconditions:** User has at least one meeting  
**Version:** V1

**Main Flow:**
1. User types query in search bar
2. System filters meetings by: title, tags, summary content (full-text search)
3. Results update in real-time as user types (debounced 300ms)
4. Matching text highlighted in results

**Exception Flows:**
- E1: No matches → "No meetings found for [query]" + [Clear search]

---

### UC-13: Filter Meetings

**Actor:** Authenticated user  
**Trigger:** User clicks filter dropdowns on meetings list  
**Version:** V1

**Filters available:**
- Status: All / Processing / Complete / Failed
- Date: Any date / Today / This week / This month / Custom range
- Tags: Multi-select from user's existing tags

**Main Flow:**
1. User selects filter value(s)
2. List updates immediately
3. Active filters shown as removable chips above the list
4. "Clear all filters" button appears when any filter is active

---

### UC-14: Rename a Meeting

**Actor:** Authenticated user (meeting owner)  
**Trigger:** User opens meeting overflow menu → "Rename"; or clicks title inline on meeting detail  
**Preconditions:** Meeting exists; user is the owner  
**Version:** V1

**Main Flow:**
1. Title becomes an editable input
2. User changes the name
3. User presses Enter or clicks away
4. System saves new title via `PATCH /api/v1/meetings/:id`
5. Title updates everywhere (list + detail + browser tab)

**Exception Flows:**
- E1: Empty title → revert to previous title, show: "Title cannot be empty"
- E2: Save fails → revert to previous title, show error toast

---

### UC-15: Tag a Meeting

**Actor:** Authenticated user  
**Trigger:** User clicks tag area on meeting detail or meeting list row  
**Version:** V1

**Main Flow:**
1. Tag input appears with dropdown of existing tags
2. User types to filter or create new tag
3. User selects or hits Enter to create new tag
4. Tag saved to meeting
5. Tags are shown as colored chips on all meeting views

---

### UC-16: Delete a Meeting

**Actor:** Authenticated user (meeting owner)  
**Trigger:** User opens meeting overflow menu → "Delete"  
**Preconditions:** Meeting exists; user is the owner  
**Version:** V1

**Main Flow:**
1. Confirmation dialog: "This will permanently delete the transcript, summary, and audio. Cannot be undone."
2. User confirms
3. System deletes: R2 audio file, transcript, summary, action items, embeddings, meeting record
4. Redirect to `/app/meetings`
5. Success toast: "Meeting deleted"

**Exception Flows:**
- E1: User cancels → no action
- E2: Deletion fails → "Could not delete. Please try again." Meeting remains unchanged.

---

### UC-17: Share a Meeting via Public Link

**Actor:** Authenticated user  
**Trigger:** User clicks "Share" on meeting detail page  
**Preconditions:** Meeting status = complete  
**Version:** V1

**Main Flow:**
1. Share panel opens
2. "Public link" toggle is OFF by default
3. User toggles ON → system generates a unique token: `/share/{token}`
4. Link shown with "Copy link" button
5. Anyone with the link can view: meeting summary + action items (no auth required)
6. User can toggle OFF at any time to revoke access

**Alternate Flows:**
- A1: User wants to share transcript too → "Include full transcript" checkbox in share panel

**Exception Flows:**
- E1: Token generation fails → "Could not create share link. Please try again."

---

## Transcript

---

### UC-18: Read a Meeting Transcript

**Actor:** Authenticated user  
**Trigger:** User opens meeting detail, selects "Transcript" tab  
**Preconditions:** Meeting status = complete  
**Version:** V1

**Main Flow:**
1. Transcript displays as paragraph-segmented text
2. Each paragraph shows: speaker label, timestamp (clickable), text
3. Transcript is fully scrollable
4. Long transcripts are paginated (1000 words per page) or lazy-loaded

---

### UC-19: Search Within a Transcript

**Actor:** Authenticated user  
**Trigger:** User presses Cmd+F or uses search input on Transcript tab  
**Version:** V1

**Main Flow:**
1. Search input appears / focuses
2. User types query
3. All matches highlighted in transcript
4. Navigation arrows: next / previous match
5. Match count shown: "3 of 12"

---

### UC-20: Navigate Transcript via Timestamp

**Actor:** Authenticated user  
**Trigger:** User clicks a timestamp in the transcript or in an action item  
**Preconditions:** Audio player is available  
**Version:** V1

**Main Flow:**
1. Audio player at bottom of screen seeks to the clicked timestamp
2. Transcript scrolls so the relevant line is visible and highlighted
3. Audio auto-plays from that point (if was already playing)

---

### UC-21: Edit Transcript (Correction)

**Actor:** Authenticated user  
**Trigger:** User double-clicks a transcript segment to edit  
**Version:** V2

**Main Flow:**
1. Segment becomes editable inline
2. User corrects text
3. User clicks "Save" or presses Enter
4. Original text preserved in audit log; new text displayed
5. Summary is NOT automatically regenerated (user must trigger manually if needed)

---

### UC-22: Rename a Speaker

**Actor:** Authenticated user  
**Trigger:** User clicks speaker label (e.g., "Speaker 1") in transcript  
**Preconditions:** Diarization was run; meeting has speaker labels  
**Version:** V2

**Main Flow:**
1. Inline input replaces "Speaker 1"
2. User types real name (e.g., "Suhaas")
3. User confirms
4. All instances of "Speaker 1" in this meeting's transcript update
5. System attempts to match this voice profile in future meetings (V2)

---

## AI Summary

---

### UC-23: View AI-Generated Summary

**Actor:** Authenticated user  
**Trigger:** User opens Meeting Detail → Summary tab  
**Preconditions:** Meeting status = complete  
**Version:** V1

**Main Flow:**
1. Summary panel shows:
   - Executive summary (3–5 sentences)
   - Key topics (bulleted list)
   - Decisions made (bulleted list)
   - Open questions / blockers

---

### UC-24: Copy Summary to Clipboard

**Actor:** Authenticated user  
**Trigger:** User clicks "Copy summary" button  
**Version:** V1

**Main Flow:**
1. Full summary text copied to clipboard (plain text, no markdown symbols)
2. Button icon changes to checkmark for 2 seconds: "Copied!"

---

### UC-25: Regenerate Summary

**Actor:** Authenticated user  
**Trigger:** User clicks "Regenerate" in summary overflow menu  
**Preconditions:** Meeting status = complete; user has edited transcript (UC-21)  
**Version:** V2

**Main Flow:**
1. Confirmation: "Regenerating will replace the current summary."
2. User confirms
3. New Claude API call with updated transcript
4. Summary updates in place with fade transition

**Exception Flows:**
- E1: Claude API unavailable → "Summary regeneration failed. Try again later."

---

## Action Items

---

### UC-26: View Action Items from a Meeting

**Actor:** Authenticated user  
**Trigger:** User opens Meeting Detail → Action Items tab  
**Preconditions:** Meeting status = complete  
**Version:** V1

**Main Flow:**
1. Action items listed, each showing: description, assignee name, due date (if detected), source timestamp
2. Items grouped by status: Open / Complete

---

### UC-27: Complete an Action Item

**Actor:** Authenticated user  
**Trigger:** User clicks checkbox on an action item  
**Preconditions:** Action item exists with status = open  
**Version:** V1

**Main Flow:**
1. Checkbox toggles checked (optimistic update)
2. Item gets strikethrough + fade
3. PATCH request sent to API: `{ completed: true }`
4. Item moves to "Completed" section

**Exception Flows:**
- E1: API call fails → revert checkbox, toast: "Could not save. Try again."

---

### UC-28: Edit an Action Item

**Actor:** Authenticated user  
**Trigger:** User clicks edit icon on an action item  
**Version:** V1

**Main Flow:**
1. Item expands into inline edit form: description, assignee, due date
2. User makes changes
3. User clicks "Save"
4. Item updates in place

---

### UC-29: Reassign an Action Item

**Actor:** Authenticated user  
**Trigger:** User clicks the assignee name on an action item → select new assignee  
**Version:** V1

**Main Flow:**
1. Dropdown shows: user's own name, any workspace members (V3), or free-text entry
2. User selects or types a name
3. Assignee updates immediately (optimistic)
4. In V3: the new assignee receives an email notification

---

### UC-30: View All Action Items (Dashboard)

**Actor:** Authenticated user  
**Trigger:** User navigates to `/app/action-items`  
**Version:** V1

**Main Flow:**
1. All action items grouped by: Overdue / Due this week / Upcoming / Completed
2. Each item shows which meeting it came from (with link)
3. Filters: by assignee, by meeting, by due date

---

### UC-31: Export Action Item to Notion

**Actor:** Authenticated user  
**Trigger:** User clicks "Export → Notion" on an action item  
**Preconditions:** Notion integration is connected (UC-44)  
**Version:** V2

**Main Flow:**
1. Export panel opens: shows Notion workspace and database selection
2. User confirms target database
3. System creates a Notion database entry with: title, description, assignee, due date, link back to EchoBrief meeting
4. Success: "Exported to Notion" chip appears on action item
5. Chip is a link to the Notion page

**Exception Flows:**
- E1: Notion API error → "Export failed. Check your Notion connection in Settings."
- E2: Integration not connected → "Connect Notion in Settings to export"

---

### UC-32: Export Action Item to Linear

**Actor:** Authenticated user  
**Trigger:** User clicks "Export → Linear" on an action item  
**Preconditions:** Linear integration connected  
**Version:** V2

Same pattern as UC-31, but creates a Linear issue. Assignee matched by email if possible.

---

## AI Chat (Per-Meeting)

---

### UC-33: Ask a Question About a Meeting

**Actor:** Authenticated user  
**Trigger:** User opens Meeting Detail → Chat tab, types a question  
**Preconditions:** Meeting status = complete  
**Version:** V1

**Main Flow:**
1. User types question in chat input
2. User clicks Send or presses Enter
3. "EchoBrief is thinking..." indicator shows
4. Response streams token-by-token into the conversation
5. After response: source quotes from transcript shown with timestamps
6. Input field re-enables for follow-up

**Exception Flows:**
- E1: Claude API error → "Couldn't generate a response. Please try again."
- E2: Question outside meeting scope → "I couldn't find relevant context in this meeting for that question."

---

### UC-34: Follow Up on a Chat Answer

**Actor:** Authenticated user  
**Trigger:** User types a follow-up after receiving an answer  
**Preconditions:** At least one message in current chat thread  
**Version:** V1

**Main Flow:**
1. Previous conversation context included in new API call
2. Claude responds with awareness of prior exchanges
3. Conversation thread grows downward

*Note: V1 — conversation history is in-memory only (lost on page refresh). V2 — persisted to DB.*

---

### UC-35: Navigate to Source Timestamp from Chat Answer

**Actor:** Authenticated user  
**Trigger:** User clicks a source citation link in a chat response  
**Version:** V1

**Main Flow:**
1. Transcript tab activates
2. Transcript scrolls to the relevant segment (highlighted)
3. Audio player seeks to that timestamp
4. Chat tab returns to previous state when user navigates back

---

## AI Chat (Cross-Meeting)

---

### UC-36: Ask a Question Across All Meetings

**Actor:** Authenticated user  
**Trigger:** User types a question in `/app/chat`  
**Preconditions:** User has at least one processed meeting  
**Version:** V1 (basic keyword) / V2 (semantic vector search)

**Main Flow:**
1. User submits question
2. System embeds query → searches transcript_chunks via pgvector (cosine similarity)
3. Top matching chunks retrieved across all user's meetings
4. Claude generates response grounded in retrieved context
5. Response streams in with source citations (meeting name + timestamp)

**Exception Flows:**
- E1: No relevant context found → "I couldn't find anything relevant in your meetings. Try different phrasing."
- E2: User has no processed meetings → "Upload and process at least one meeting to start asking questions."

---

### UC-37: Use a Suggested Query

**Actor:** Authenticated user  
**Trigger:** User clicks a suggested query chip on the empty chat screen  
**Version:** V1

**Main Flow:**
1. Suggested query populates input
2. Query auto-submits immediately
3. Proceeds as UC-36

---

### UC-38: Navigate to Source Meeting from Search Answer

**Actor:** Authenticated user  
**Trigger:** User clicks a citation in a cross-meeting chat response  
**Version:** V1

**Main Flow:**
1. Navigate to `/app/meetings/:id` at the source timestamp
2. Transcript scrolls to cited segment (highlighted)
3. Audio seeks to that point
4. Back button returns to chat with conversation intact

---

## Analytics

---

### UC-39: View Dashboard Stats

**Actor:** Authenticated user  
**Trigger:** User opens `/app/` (Dashboard)  
**Version:** V1

**Main Flow:**
1. Four stat cards load:
   - Total meetings processed
   - Total hours transcribed
   - Total summaries generated
   - Pending action items
2. Data reflects all-time totals (no date filter on dashboard stats)

---

### UC-40: View Meeting Frequency Chart

**Actor:** Authenticated user  
**Trigger:** User views Dashboard; chart loads automatically  
**Version:** V1

**Main Flow:**
1. Bar chart shows: meetings per day for the last 30 days
2. Hover on a bar shows count and date tooltip
3. Zero-value days shown as empty bars (not omitted)

---

### UC-41: View Meeting Score

**Actor:** Authenticated user  
**Trigger:** User opens Meeting Detail → score chip in header  
**Version:** V2

**Main Flow:**
1. Score panel opens (slide-in or modal)
2. Overall score displayed prominently: "7.4 / 10"
3. Sub-scores with descriptions:
   - Participation: 8.2 — "Good balance across 3 speakers"
   - Actionability: 7.0 — "5 clear action items defined"
   - Focus: 7.5 — "Stayed mostly on topic with one tangent"
   - Clarity: 8.0 — "Communication was direct and specific"
   - Efficiency: 6.5 — "Meeting ran 8 minutes over scheduled time"
4. Comparison: "Above your average of 6.9"

---

### UC-42: View Speaker Participation Stats

**Actor:** Authenticated user  
**Trigger:** User opens Meeting Detail → Analytics tab  
**Preconditions:** Meeting has diarization data (V2)  
**Version:** V2

**Main Flow:**
1. Donut chart shows talk-time percentage per speaker
2. Table: speaker name, word count, talk time, longest monologue
3. "Participation balance" chip: Balanced / Skewed / Single speaker

---

### UC-43: Filter Analytics by Date Range

**Actor:** Authenticated user  
**Trigger:** User uses date range picker on `/app/analytics`  
**Version:** V1

**Main Flow:**
1. User selects preset (Last 7 days / 30 days / 90 days) or custom date range
2. All charts and stats update to reflect selected range
3. Selected range persisted across page navigation (query param)

---

## Integrations (V2)

---

### UC-44: Connect a Notion Integration

**Actor:** Authenticated user  
**Trigger:** User clicks "Connect" next to Notion in Settings → Integrations  
**Version:** V2

**Main Flow:**
1. Browser redirects to Notion OAuth authorization page
2. User grants EchoBrief access to their Notion workspace
3. Notion redirects to `/api/v1/integrations/notion/callback`
4. System exchanges code for access token + workspace info
5. Token encrypted and stored in `integrations` table
6. Settings page shows: "Notion connected · [Workspace Name]"

**Exception Flows:**
- E1: User denies access → return to Settings, no change
- E2: OAuth error → "Failed to connect Notion. Please try again."

---

### UC-45: Disconnect an Integration

**Actor:** Authenticated user  
**Trigger:** User clicks "Disconnect" next to a connected integration  
**Version:** V2

**Main Flow:**
1. Confirmation: "This will remove your Notion connection. Existing exports will not be affected."
2. User confirms
3. System deletes stored token from `integrations` table
4. Revokes token with Notion API (best-effort)
5. Integration shows "Not connected"

---

### UC-46: Generate Follow-Up Email

**Actor:** Authenticated user  
**Trigger:** User clicks "Generate email" in Meeting Detail overflow menu  
**Preconditions:** Meeting status = complete  
**Version:** V2

**Main Flow:**
1. Side panel opens with email type selector:
   - Meeting Recap (default)
   - Stakeholder Update
   - Sprint Summary
   - Action Item Assignments
2. User selects type, optionally selects tone (Professional / Casual)
3. User clicks "Generate"
4. Claude generates email; text streams into editable area
5. User edits if needed
6. "Copy to clipboard" and "Open in Gmail" buttons available

**Exception Flows:**
- E1: Claude API error → "Generation failed. Try again."

---

## Settings

---

### UC-47: Update Profile Information

**Actor:** Authenticated user  
**Trigger:** User navigates to Settings → Profile  
**Version:** V1

**Main Flow:**
1. User updates name, avatar (upload new image)
2. User clicks "Save changes"
3. System updates `users` table + Supabase Auth profile
4. Avatar shown in header updates immediately

---

### UC-48: Change Password

**Actor:** Authenticated user (email/password account only)  
**Trigger:** User clicks "Change password" on Profile settings  
**Version:** V1

**Main Flow:**
1. Form: current password, new password, confirm new password
2. System verifies current password with Supabase Auth
3. System updates password
4. All other sessions invalidated (security behavior)
5. Confirmation email sent

**Exception Flows:**
- E1: Current password incorrect → "Current password is incorrect"
- E2: New password too weak → inline validation error

---

### UC-49: Manage Notification Preferences

**Actor:** Authenticated user  
**Trigger:** User navigates to Settings → Notifications  
**Version:** V1

**Options:**
- Email when processing complete: On/Off (default: On)
- Email for upcoming action item deadlines: On/Off (default: On)
- Digest: Daily summary of pending items: On/Off (default: Off)
- Browser push notifications: Opt-in (browser permission required)

---

### UC-50: Export Personal Data (GDPR)

**Actor:** Authenticated user  
**Trigger:** User navigates to Settings → Danger Zone → "Export my data"  
**Version:** V1

**Main Flow:**
1. User clicks "Export my data"
2. System queues data export job
3. Email sent when ready (may take up to 1 hour for large accounts)
4. Download link in email provides: ZIP file containing all meetings as JSON + transcript text files

---

## Team & Collaboration (V3)

---

### UC-51: Create a Workspace

**Actor:** Authenticated user  
**Trigger:** User clicks "Create workspace" in workspace switcher  
**Preconditions:** User is on a paid plan  
**Version:** V3

**Main Flow:**
1. Modal: workspace name, optional logo upload
2. System creates workspace record
3. User is set as Admin
4. Workspace switcher shows new workspace
5. All existing meetings remain under user's personal account (not auto-migrated)

---

### UC-52: Invite a Team Member

**Actor:** Workspace Admin  
**Trigger:** Admin clicks "Invite members" in Settings → Workspace  
**Version:** V3

**Main Flow:**
1. Admin enters email address(es), selects role (Member / Viewer)
2. System sends invitation email
3. Invited user receives: "You've been invited to join [workspace name] on EchoBrief"
4. Pending invitations shown in Settings with revoke option

---

### UC-53: Accept Workspace Invitation

**Actor:** Invited user (may or may not have existing EchoBrief account)  
**Trigger:** User clicks "Accept invitation" in email  
**Version:** V3

**Main Flow (existing user):**
1. Click link → log in if not already
2. System adds user to workspace_members table
3. Workspace appears in user's workspace switcher

**Main Flow (new user):**
1. Click link → redirected to `/signup` with workspace context
2. User creates account
3. System auto-joins workspace after signup

---

### UC-54: Remove a Team Member

**Actor:** Workspace Admin  
**Trigger:** Admin clicks "Remove" next to a member in Settings → Workspace  
**Version:** V3

**Main Flow:**
1. Confirmation: "Remove [Name] from [Workspace]? They'll lose access to all team meetings."
2. Admin confirms
3. User removed from workspace_members
4. User can no longer see team meetings

---

### UC-55: Comment on a Transcript Section

**Actor:** Authenticated user (with workspace access to the meeting)  
**Trigger:** User selects text in transcript → clicks "Comment"  
**Version:** V3

**Main Flow:**
1. User selects a text range in transcript
2. Comment popover appears
3. User types comment, can @mention teammates
4. Comment saved with: selected text range, author, timestamp
5. Mentioned users receive email notification
6. Comments visible as margin annotations to all workspace members with access

---

### UC-56: Start a Live Transcription Session

**Actor:** Authenticated user  
**Trigger:** User clicks "Start live session" from upload page or nav  
**Preconditions:** Browser microphone permission granted  
**Version:** V3

**Main Flow:**
1. User clicks "Start live session"
2. Browser requests microphone permission (if not already granted)
3. WebSocket connection established to Deepgram Streaming API via backend
4. Audio streams in real-time; transcript appears with ~1.5 second latency
5. Live action items panel updates as items are detected
6. User clicks "Stop" when meeting ends
7. Session saved as a regular meeting; same AI analysis pipeline runs
8. User redirected to Meeting Detail when processing completes

**Exception Flows:**
- E1: Microphone denied → "Microphone access is required. Check your browser settings."
- E2: WebSocket connection lost → "Connection interrupted. Reconnecting..." (auto-retry)
- E3: Tab/window closed mid-session → session saved up to the point of disconnection

---

## Use Case Coverage Summary

| Domain | V1 UCs | V2 UCs | V3 UCs | Total |
|--------|--------|--------|--------|-------|
| Authentication | 6 | — | — | 6 |
| Meeting Processing | 4 | — | — | 4 |
| Meeting Management | 7 | — | — | 7 |
| Transcript | 3 | 2 | — | 5 |
| AI Summary | 2 | 1 | — | 3 |
| Action Items | 5 | 2 | — | 7 |
| AI Chat (Per-Meeting) | 3 | — | — | 3 |
| AI Chat (Cross-Meeting) | 3 | — | — | 3 |
| Analytics | 3 | 2 | — | 5 |
| Integrations | — | 3 | — | 3 |
| Settings | 4 | — | — | 4 |
| Team & Collaboration | — | — | 6 | 6 |
| **Total** | **40** | **10** | **6** | **56** |
