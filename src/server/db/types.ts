/**
 * Database row types (manually maintained — mirror migrations/*.sql).
 */

import type { NotableMoment } from "../lib/moments";

export type MeetingStatus =
  | "queued"
  | "transcribing"
  | "analyzing"
  | "indexing"
  | "complete"
  | "failed";

export type MeetingVisibility = "private" | "team";

export type IntegrationProvider = "notion" | "linear" | "jira" | "google_calendar" | "trello";

export type AccountType = "student" | "professional";

export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  password_hash: string | null;
  /** Google's `sub` claim. NULL for users who only ever used email/password. */
  google_id: string | null;
  is_admin: boolean;
  default_account_type: AccountType | null;
  /**
   * Tokens issued before this instant are rejected by requireAuth. Bumped on
   * password change so a stolen bearer token dies with the password. See
   * migration 0012.
   */
  sessions_valid_from: string;
  created_at: string;
  updated_at: string;
}

/**
 * One row per (user, workspace) — see migration 0015. A missing row is normal
 * and means every preference is at its fallback, so readers must LEFT JOIN or
 * tolerate an empty result rather than treating absence as an error.
 */
export interface UserPreferencesRow {
  user_id: string;
  workspace_id: string;
  /** `"auto"` for language detection, a language code, or NULL for "unset". */
  transcription_language: string | null;
  vocabulary: string[];
  /** NULL = platform default, 0 = keep until deleted by hand, N = N days. */
  audio_retention_days: number | null;
  /**
   * How the user asked their summaries to be written. NULL on each of the three
   * means "never chosen", which the pipeline treats as "write it the way you
   * would have before these existed" — not as choosing the default.
   */
  summary_style: "executive" | "detailed" | "bullets" | "decisions" | null;
  summary_length: "short" | "standard" | "long" | null;
  summary_tone: "neutral" | "direct" | "warm" | null;
  /** No third state, and extraction has always been on, so this is NOT NULL. */
  detect_action_items: boolean;
  /**
   * Mask profanity in the transcript AssemblyAI returns. NOT NULL for the same
   * reason as above, defaulting to FALSE because filtering has always been off
   * — see migration 0019. Read at TRANSCRIPTION time, not at analysis time: it
   * changes what the vendor sends back, not how the summary is written.
   */
  filter_profanity: boolean;
  created_at: string;
  updated_at: string;
}

export interface FlashcardRow {
  id: string;
  meeting_id: string;
  workspace_id: string;
  user_id: string;
  question: string;
  answer: string;
  difficulty: "easy" | "medium" | "hard" | null;
  last_reviewed_at: string | null;
  review_count: number;
  created_at: string;
}

export interface MeetingRow {
  id: string;
  user_id: string;
  workspace_id: string | null;
  title: string;
  audio_key: string | null;
  audio_size: number | null;
  audio_mime: string | null;
  duration_sec: number | null;
  language: string;
  status: MeetingStatus;
  failure_reason: string | null;
  visibility: MeetingVisibility;
  share_token: string | null;
  tags: string[];
  meeting_score: Record<string, unknown> | null;
  retry_count: number;
  created_at: string;
  processed_at: string | null;
}

export interface TranscriptRow {
  id: string;
  meeting_id: string;
  raw_text: string;
  content: Record<string, unknown>;
  speakers: Array<{ id: string; label: string; talk_time_sec: number; word_count: number }>;
  language: string | null;
  provider: string;
  created_at: string;
}

export interface SummaryRow {
  id: string;
  meeting_id: string;
  executive: string | null;
  key_topics: string[];
  decisions: string[];
  open_questions: string[];
  chapters: Array<{ title: string; start_sec: number; end_sec: number; summary: string }>;
  /**
   * Moments from the conversation, each carrying the transcript words that
   * justify it. Written only after `groundMoments` has verified every quote, so
   * a row here is evidence rather than an assertion. `[]` for every summary
   * written before migration 0020, and for most meetings since.
   */
  notable_moments: NotableMoment[];
  model: string | null;
  generated_at: string;
}

export interface ActionItemRow {
  id: string;
  meeting_id: string;
  user_id: string;
  description: string;
  assignee_name: string | null;
  assignee_id: string | null;
  due_date: string | null;
  completed: boolean;
  completed_at: string | null;
  timestamp_sec: number | null;
  export_refs: Record<string, string>;
  created_at: string;
  updated_at: string;
}

/**
 * One uploaded piece of a segmented recording — see migration 0016. Rows exist
 * only for meetings the mobile app recorded in segments; single-file uploads
 * have none, which is exactly how the worker tells the two apart.
 */
export interface MeetingSegmentRow {
  meeting_id: string;
  user_id: string;
  workspace_id: string;
  /** 0-based position in the recording. Ordering key; never created_at. */
  index: number;
  audio_key: string;
  /**
   * Server-observed size from HeadObject.
   *
   * Typed as a STRING because that is what actually arrives. The column is
   * BIGINT (oid 20), and postgres.js only parses oids [21, 23, 26, 700, 701]
   * into numbers — int8 is deliberately left as text so large values cannot
   * lose precision. Callers must therefore Number() it before doing arithmetic;
   * `sum + row.bytes` would concatenate strings and hand the join a
   * Content-Length like "480123480456", which R2 rejects outright.
   */
  bytes: string;
  created_at: string;
}

export interface TranscriptChunkRow {
  id: string;
  meeting_id: string;
  user_id: string;
  chunk_index: number;
  content: string;
  start_sec: number | null;
  end_sec: number | null;
  embedding: number[] | null;
  created_at: string;
}

export interface IntegrationRow {
  id: string;
  user_id: string;
  provider: IntegrationProvider;
  workspace_name: string | null;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface PipelineLogRow {
  id: string;
  meeting_id: string | null;
  user_id: string | null;
  step: string;
  provider: string | null;
  model: string | null;
  duration_ms: number | null;
  cost_usd: number | null;
  status: "success" | "failure";
  error: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface MatchedChunkRow {
  id: string;
  meeting_id: string;
  meeting_title: string;
  content: string;
  start_sec: number | null;
  end_sec: number | null;
  similarity: number;
}
