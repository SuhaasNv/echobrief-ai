import { Alert } from "react-native";
import { onlineManager, useMutation, useQueryClient } from "@tanstack/react-query";

import { haptics } from "@/lib/haptics";

import { api } from "./client";
import { describeActionFailure } from "./errors";
import type { MeetingDetail, Speaker } from "./meeting-detail";
import { qk } from "./meetings";

/**
 * Putting real names on diarized voices.
 *
 * PATCH /meetings/:id/speakers takes the WHOLE map — it replaces
 * transcripts.speaker_names wholesale — so every write here sends every name,
 * not just the one that changed. Sending a single entry silently clears the
 * others, which is the kind of bug that only shows up on the third speaker.
 *
 * Names are per meeting by design. AssemblyAI assigns "A" independently for each
 * recording, so "A" in Monday's standup is not "A" in Tuesday's; migration
 * 0010_speaker_names.sql argues this at length. Cross-meeting identity needs
 * voice embeddings and is deliberately out of scope — what IS reusable is the
 * name text, offered again as a suggestion, never applied automatically.
 */

/** `SpeakerNamesRequest` in packages/shared/src/schemas.ts caps the value at 80. */
export const SPEAKER_NAME_MAX = 80;

/** What the server renders for a voice nobody has named. Mirrors displaySpeaker. */
export function fallbackLabel(speakerId: string): string {
  return `Speaker ${speakerId}`;
}

/** The name a user gave this voice, or "" when it is still the fallback. */
export function customName(speaker: Speaker): string {
  return speaker.label === fallbackLabel(speaker.id) ? "" : speaker.label;
}

/** The map as it stands right now, ready to be edited and sent back whole. */
export function currentNames(speakers: Speaker[]): Record<string, string> {
  const names: Record<string, string> = {};
  for (const speaker of speakers) {
    const name = customName(speaker);
    if (name) names[speaker.id] = name;
  }
  return names;
}

/**
 * Re-label a cached meeting as the server would.
 *
 * The server resolves names in ONE place — buildTranscriptResponse — and applies
 * them to two things: `speakers[].label` and every `segments[].speaker`. The
 * segments carry the resolved display label rather than the raw id, so an
 * optimistic update that only touched the speaker list would rename the share
 * bar and leave the transcript reading "Speaker B" until the refetch landed.
 *
 * Exported for the test the absence of a test runner in this app currently
 * prevents, and because reading it beside `displaySpeaker` in
 * src/server/api/routes/meetings.ts is the only way to keep the two in step.
 */
export function applySpeakerNames(
  detail: MeetingDetail,
  names: Record<string, string>,
): MeetingDetail {
  const transcript = detail.transcript;
  if (!transcript) return detail;

  // Old display label → new one. Built from the labels as they are NOW, in a
  // single pass, so two voices swapping names resolves correctly instead of
  // cascading one into the other.
  const relabel = new Map<string, string | null>();
  let changed = false;

  const speakers = transcript.speakers.map((speaker) => {
    const named = names[speaker.id]?.trim();
    const label = named ? named : fallbackLabel(speaker.id);
    if (label === speaker.label) return speaker;

    changed = true;
    // A duplicate old label is genuinely ambiguous from the client's side: the
    // segments only carry the label, so there is no way to tell whose turn is
    // whose. Marked null and skipped rather than guessed — the server resolves
    // from the raw id and repairs it on the refetch a moment later.
    relabel.set(speaker.label, relabel.has(speaker.label) ? null : label);
    return { ...speaker, label };
  });

  if (!changed) return detail;

  const segments = transcript.segments.map((segment) => {
    const next = segment.speaker ? relabel.get(segment.speaker) : undefined;
    return next ? { ...segment, speaker: next } : segment;
  });

  return { ...detail, transcript: { ...transcript, speakers, segments } };
}

export interface SpeakerRename {
  /** The complete map to persist. The endpoint replaces, it does not merge. */
  names: Record<string, string>;
  /** How the voice read before this change, for the rollback message. */
  previousLabel: string;
  /** What it should read now. Empty when the name is being cleared. */
  nextLabel: string;
}

/**
 * Optimistic, with a real rollback.
 *
 * Same shape as useToggleActionItem in ./action-items, and for the same reasons:
 *
 *   networkMode "always", so an offline write FAILS instead of being parked. The
 *   default would leave the transcript reading "Priya" against a request that
 *   never left the device and dies with the process.
 *
 *   Cancel, then snapshot. The detail query polls every 5s while a meeting is
 *   processing; a refetch landing mid-mutation would overwrite the optimistic
 *   labels and the name would visibly flicker back to "Speaker B".
 *
 *   The rollback SAYS something. A name that appears and then quietly undoes
 *   itself is indistinguishable from the app losing the change on purpose.
 */
export function useRenameSpeakers(meetingId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    networkMode: "always",

    mutationFn: ({ names }: SpeakerRename) =>
      api.apiRequest<{ ok: true; names: Record<string, string> }>(
        `/meetings/${meetingId}/speakers`,
        { method: "PATCH", body: { names } },
      ),

    onMutate: async ({ names }) => {
      await queryClient.cancelQueries({ queryKey: qk.meeting(meetingId) });
      const previous = queryClient.getQueryData<MeetingDetail>(qk.meeting(meetingId));

      queryClient.setQueryData<MeetingDetail>(qk.meeting(meetingId), (old) =>
        old ? applySpeakerNames(old, names) : old,
      );

      return { previous };
    },

    onSuccess: () => haptics.success(),

    onError: (error, variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(qk.meeting(meetingId), context.previous);
      }

      haptics.error();
      Alert.alert(
        `That voice is still ${variables.previousLabel}`,
        `${describeActionFailure(error, { online: onlineManager.isOnline() })} EchoBrief put the label back. Choosing the name again retries.`,
      );
    },

    onSettled: () => {
      // The list carries `participant_count`, which is a count of voices and
      // does not move when one is named — so only the detail query is
      // reconciled. Same reasoning as useRenameMeeting.
      void queryClient.invalidateQueries({ queryKey: qk.meeting(meetingId) });
    },
  });
}
