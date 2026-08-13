import { useMemo } from "react";
import { Alert } from "react-native";

import { useActionItems, useMeetingActionItems } from "@/lib/api/action-items";
import type { MeetingDetail, Speaker } from "@/lib/api/meeting-detail";
import {
  currentNames,
  customName,
  fallbackLabel,
  SPEAKER_NAME_MAX,
  useRenameSpeakers,
} from "@/lib/api/speaker-names";
import { formatDuration } from "@/lib/format";
import { suggestSpeakerNames } from "@/lib/speaker-suggestions";

import { MeetingMenuSheet, type MenuGroup, type MenuRow } from "./menu-sheet";

/**
 * Putting a name to one voice.
 *
 * The sheet is the meeting menu's, unchanged — same card, same hairlines, same
 * SF Symbol chips, same "run the action after the Modal has dismissed" rule that
 * lets a row present a UIAlertController without iOS refusing it. A second
 * grouped-sheet implementation would be 1pt off the first within a week.
 *
 * The rows are names rather than commands, which is the whole point: the user
 * should be tapping a name the app already knows, not typing one on a phone
 * keyboard. Typing is still there, last, for the case where we are wrong.
 *
 * Where the names come from, in the order they are offered:
 *
 *   Attributed to THIS voice by the transcript — someone introducing themselves,
 *   or being addressed immediately before this voice answered. Each row says
 *   which, and at what timestamp, so the suggestion can be checked rather than
 *   trusted. See lib/speaker-suggestions.
 *
 *   Named anywhere in this workspace's action items. That is the only
 *   cross-meeting name index the server actually exposes — `speaker_names` is
 *   per transcript with no aggregate endpoint — and it is server-side, so a name
 *   offered here is one the browser can see too.
 *
 * Names already in use on another voice in this meeting are never offered.
 */

/**
 * Row budget.
 *
 * The sheet is bottom-anchored, so anything it cannot fit is pushed off the TOP
 * and the title goes first. Six names plus two actions clears the shortest
 * supported iPhone; a longer list would be a worse way to pick a name anyway.
 */
const MAX_ATTRIBUTED = 3;
const MAX_OTHER = 3;

function uniqueNames(values: Array<string | null | undefined>): string[] {
  const seen = new Map<string, string>();
  for (const value of values) {
    const name = value?.trim();
    if (!name || name.length > SPEAKER_NAME_MAX) continue;
    const key = name.toLowerCase();
    if (!seen.has(key)) seen.set(key, name);
  }
  return Array.from(seen.values());
}

/**
 * Type it instead.
 *
 * Alert.prompt is a real UIAlertController with a text field, so it inherits the
 * keyboard, Dynamic Type and dismissal for free — the same argument
 * promptRenameMeeting makes in ./delete-meeting.
 */
function promptSpeakerName(options: {
  /** Pre-filled into the field. Empty for a voice nobody has named yet. */
  current: string;
  onSubmit: (name: string) => void;
}): void {
  const { current, onSubmit } = options;

  Alert.prompt(
    "Name this voice",
    "Names apply to this meeting only — the recording's voice labels are assigned per recording, so this one is not the same person as the next meeting's.",
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Save",
        onPress: (value?: string) => {
          const next = (value ?? "").trim().slice(0, SPEAKER_NAME_MAX);
          // A blank field is a cancel, not a request to clear the name — there
          // is a row for that, and it says what it does.
          if (!next || next === current.trim()) return;
          onSubmit(next);
        },
      },
    ],
    "plain-text",
    current,
  );
}

export interface NameSpeakerSheetProps {
  meeting: MeetingDetail;
  /** The voice being named. Its `id` is the raw diarization label ("A"). */
  speaker: Speaker;
  /** Fired after the sheet has gone and the picked action has run. */
  onDismissed: () => void;
}

export function NameSpeakerSheet({ meeting, speaker, onDismissed }: NameSpeakerSheetProps) {
  const rename = useRenameSpeakers(meeting.id);

  // Both are cached queries the app already runs elsewhere — the meeting's own
  // items are fetched by the header menu, and the workspace list is the Actions
  // tab's. This component only mounts while the sheet is open, so opening the
  // sheet is the first thing that can pay for either of them.
  const { data: meetingItems } = useMeetingActionItems(meeting.id);
  const { data: workspaceItems } = useActionItems();

  const speakers = useMemo(() => meeting.transcript?.speakers ?? [], [meeting.transcript]);
  const segments = useMemo(() => meeting.transcript?.segments ?? [], [meeting.transcript]);

  const fromThisMeeting = useMemo(
    () => uniqueNames((meetingItems ?? []).map((item) => item.assignee_name)),
    [meetingItems],
  );

  const fromOtherMeetings = useMemo(
    () =>
      uniqueNames(
        (workspaceItems ?? [])
          .filter((item) => item.meeting_id !== meeting.id)
          .map((item) => item.assignee_name),
      ),
    [workspaceItems, meeting.id],
  );

  const suggestions = useMemo(
    () => suggestSpeakerNames(segments, speakers, [...fromThisMeeting, ...fromOtherMeetings]),
    [segments, speakers, fromThisMeeting, fromOtherMeetings],
  );

  /** Names spoken for by another voice in this meeting. Never re-offered. */
  const taken = useMemo(() => {
    const set = new Set<string>();
    for (const other of speakers) {
      if (other.id === speaker.id) continue;
      const name = customName(other);
      if (name) set.add(name.toLowerCase());
    }
    return set;
  }, [speakers, speaker.id]);

  const existing = customName(speaker);

  const save = (name: string): void => {
    const next = name.trim().slice(0, SPEAKER_NAME_MAX);
    if (next === existing) return;

    // The endpoint REPLACES speaker_names, so the whole map goes every time.
    const names = currentNames(speakers);
    if (next) names[speaker.id] = next;
    else delete names[speaker.id];

    rename.mutate({
      names,
      previousLabel: speaker.label,
      nextLabel: next || fallbackLabel(speaker.id),
    });
  };

  const nameRow = (name: string, detail: string, key: string): MenuRow => ({
    key,
    label: name,
    detail,
    symbol: "person.crop.circle",
    // Violet is "a model produced this" everywhere in this app, and every name
    // on this sheet was extracted from the meeting rather than typed by anyone.
    // The two rows below that are the user's own doing stay neutral.
    tone: "violet",
    hint: `Names this voice ${name} for this meeting`,
    run: () => save(name),
  });

  const groups = ((): MenuGroup[] => {
    const attributed = (suggestions.forSpeaker.get(speaker.id) ?? [])
      .filter((s) => !taken.has(s.name.toLowerCase()) && s.name !== existing)
      .slice(0, MAX_ATTRIBUTED);

    const attributedKeys = new Set(attributed.map((s) => s.name.toLowerCase()));

    const other: MenuRow[] = [];
    const pushOther = (names: string[], detail: string): void => {
      for (const name of names) {
        if (other.length >= MAX_OTHER) return;
        const key = name.toLowerCase();
        if (taken.has(key) || attributedKeys.has(key) || name === existing) continue;
        if (other.some((row) => row.label.toLowerCase() === key)) continue;
        other.push(nameRow(name, detail, `other-${key}`));
      }
    };

    // Heard in this meeting but not pinned to a voice, then this meeting's
    // assignees, then the rest of the workspace. Nearest evidence first.
    pushOther(suggestions.unplaced, "Mentioned in this meeting");
    pushOther(fromThisMeeting, "Mentioned in this meeting");
    pushOther(fromOtherMeetings, "Used in another meeting");

    const groups: MenuGroup[] = [];

    if (attributed.length) {
      groups.push({
        key: "attributed",
        rows: attributed.map((s) => nameRow(s.name, s.reason, `suggested-${s.name.toLowerCase()}`)),
      });
    }

    if (other.length) groups.push({ key: "other", rows: other });

    const manual: MenuRow[] = [
      {
        key: "type",
        label: existing ? "Change the name" : "Type a name",
        symbol: "keyboard",
        hint: "Opens a field to type a name for this voice",
        run: () => promptSpeakerName({ current: existing, onSubmit: save }),
      },
    ];

    if (existing) {
      manual.push({
        key: "clear",
        label: "Remove name",
        detail: `This voice goes back to ${fallbackLabel(speaker.id)}`,
        symbol: "person.crop.circle.badge.xmark",
        destructive: true,
        hint: `Clears the name and shows ${fallbackLabel(speaker.id)} again`,
        run: () => save(""),
      });
    }

    groups.push({ key: "manual", rows: manual });

    return groups;
  })();

  // Share of the talking, which is the one thing that distinguishes two
  // otherwise identical "Speaker" rows before you know who they are.
  const total = speakers.reduce((sum, s) => sum + Math.max(0, s.talk_time_sec), 0);
  const percent = total > 0 ? Math.round((Math.max(0, speaker.talk_time_sec) / total) * 100) : null;
  const duration = formatDuration(speaker.talk_time_sec);
  const meta =
    [percent === null ? null : `${percent}% of the talking`, duration]
      .filter(Boolean)
      .join(" · ") || null;

  return (
    <MeetingMenuSheet title={speaker.label} meta={meta} groups={groups} onDismissed={onDismissed} />
  );
}
