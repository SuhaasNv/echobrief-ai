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

export interface MeetingSummaryBlock {
  executive: string | null;
  key_topics: string[];
  decisions: string[];
  open_questions: string[];
  chapters: { title: string; start_sec: number; end_sec: number; summary: string }[];
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
