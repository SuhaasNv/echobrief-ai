/**
 * Database row types (manually maintained — mirror migrations/*.sql).
 */

export type MeetingStatus =
  | "queued"
  | "transcribing"
  | "analyzing"
  | "indexing"
  | "complete"
  | "failed";

export type MeetingVisibility = "private" | "team";

export type IntegrationProvider =
  | "notion"
  | "linear"
  | "jira"
  | "google_calendar"
  | "trello";

export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  password_hash: string | null;
  is_admin: boolean;
  created_at: string;
  updated_at: string;
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
