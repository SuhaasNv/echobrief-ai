import { useQuery } from "@tanstack/react-query";

import { api } from "./client";
import { isProcessing, qk, type MeetingSummary } from "./meetings";

export interface TranscriptSegment {
  speaker: string | null;
  start_sec: number;
  end_sec: number;
  text: string;
}

export interface Speaker {
  id: string;
  label: string;
  talk_time_sec: number;
  word_count: number;
}

export interface MeetingScore {
  total: number;
  participation: number;
  actionability: number;
  focus: number;
  clarity: number;
  efficiency: number;
  explanation: string;
}

/**
 * The kinds of moment the analyst may flag. Mirrors MOMENT_KINDS in
 * src/server/lib/moments.ts — add one there and the enum in ANALYSIS_SCHEMA
 * before adding it here, or the chip renders with no label.
 *
 * Every one of these is an ACT someone performed in words, never a state they
 * were in. There is deliberately no "frustrated", "excited" or "bored": the
 * pipeline reads a transcript and has never heard the audio, so a feeling would
 * be a guess printed next to a real colleague's name.
 */
export type MomentKind = "disagreement" | "hesitation" | "enthusiasm" | "alignment" | "concern";

export interface NotableMoment {
  kind: MomentKind;
  description: string;
  /** The speaker's own words. Verified server-side to appear in the transcript. */
  quote: string;
  /** The diarization label the quote was found under, e.g. "Speaker A". */
  speaker: string | null;
  timestamp_sec: number | null;
}

export interface MeetingSummaryBlock {
  executive: string | null;
  key_topics: string[];
  decisions: string[];
  open_questions: string[];
  chapters: { title: string; start_sec: number; end_sec: number; summary: string }[];
  /**
   * Optional because a response cached by an older build of this app has no
   * such key, and react-query will hand that cached object straight to the
   * summary pane on launch. The server always sends the field now — `[]` for
   * summaries written before migration 0020, and for most meetings since.
   */
  notable_moments?: NotableMoment[];
}

export interface MeetingDetail {
  id: string;
  title: string;
  status: MeetingSummary["status"];
  failure_reason?: string | null;
  retry_count?: number;
  duration_sec: number | null;
  language: string;
  tags: string[];
  /**
   * The live public share token, or null when nothing is shared.
   *
   * GET /meetings/:id selects the whole row, so this has always been on the
   * wire; the mobile type simply never declared it. It is what lets the share
   * menu know a link already exists WITHOUT asking the server, which matters
   * because POST /meetings/:id/share mints a brand new token every time it is
   * called with `enabled: true` — using that endpoint to find out would revoke
   * the link the user had already sent someone.
   */
  share_token: string | null;
  has_audio: boolean;
  transcript_provided: boolean;
  meeting_score: MeetingScore | null;
  transcript: {
    raw_text: string;
    segments: TranscriptSegment[];
    speakers: Speaker[];
  } | null;
  summary: MeetingSummaryBlock | null;
  created_at: string;
  processed_at: string | null;
  recorded_at?: string | null;
}

export function useMeetingDetail(id: string) {
  return useQuery({
    // Shared with the delete and rename paths, which have to address this exact
    // key to remove or patch it. An inline literal here drifted from theirs.
    queryKey: qk.meeting(id),
    queryFn: () => api.apiRequest<MeetingDetail>(`/meetings/${id}`),
    // The detail screen is where someone actively watches a meeting process, so
    // it polls tighter than the list's 15s.
    refetchInterval: (query) =>
      query.state.data && isProcessing(query.state.data.status) ? 5_000 : false,
  });
}

/**
 * Speaker attribution colours, assigned deterministically by order of first
 * appearance. All five are verified >= 4.5:1 on the surface colour.
 *
 * Never the sole carrier of identity — the speaker's name label is always
 * rendered alongside.
 */
export const SPEAKER_CLASSES = [
  "text-speaker-a",
  "text-speaker-b",
  "text-speaker-c",
  "text-speaker-d",
  "text-speaker-e",
] as const;

export function speakerClass(speakerId: string | null, speakers: Speaker[]): string {
  if (!speakerId) return "text-label-secondary";
  const index = speakers.findIndex((s) => s.id === speakerId);
  return SPEAKER_CLASSES[index % SPEAKER_CLASSES.length] ?? "text-label-secondary";
}
