import { Alert } from "react-native";
import type { QueryClient } from "@tanstack/react-query";

import { scheduleMeetingDelete } from "@/lib/api/meetings";
import { haptics } from "@/lib/haptics";

/**
 * The two destructive dialogs, in one place.
 *
 * Both the header menu and the swipe action land here so the wording, the
 * button styles, and the haptics are identical whichever way the user reached
 * the delete. Two copies of this drifted apart the moment one of them was
 * edited.
 *
 * The confirm NAMES the meeting. A generic "Delete this meeting?" is a dialog
 * you learn to tap through; a dialog carrying the title is one you actually
 * read, and it is the only thing standing between a mis-aimed swipe on a
 * scrolling list and an unrecoverable recording.
 */

/** Titles are long enough to blow out an alert; the quotes have to stay visible. */
const TITLE_LIMIT = 48;

function quoted(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length <= TITLE_LIMIT) return `"${trimmed}"`;
  return `"${trimmed.slice(0, TITLE_LIMIT - 1).trimEnd()}…"`;
}

export function confirmDeleteMeeting(options: {
  id: string;
  title: string;
  queryClient: QueryClient;
  /** Runs only if the user confirms, after the undo window has been started. */
  onConfirmed?: () => void;
}): void {
  const { id, title, queryClient, onConfirmed } = options;

  // Warning, not success: something irreversible is being proposed. Fired as
  // the alert is presented, matching app/(app)/account/delete.tsx.
  haptics.warning();

  Alert.alert(
    `Delete ${quoted(title)}?`,
    "The recording, transcript, and summary go with it, and support cannot get them back. You will have a few seconds to undo.",
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          // Heavier than the presentation tick. This is the commit.
          haptics.medium();
          scheduleMeetingDelete(id, title, queryClient);
          onConfirmed?.();
        },
      },
    ],
  );
}

/** Matches MeetingPatchRequest in packages/shared/src/schemas.ts. */
const TITLE_MAX = 200;

/**
 * Rename through the system prompt rather than a bespoke sheet.
 *
 * Alert.prompt is a real UIAlertController with a text field, so it inherits
 * the keyboard, the Dynamic Type sizing, and the dismissal behaviour for free.
 * A custom sheet for a single text field would be more code and less native.
 */
export function promptRenameMeeting(options: {
  current: string;
  onSubmit: (title: string) => void;
}): void {
  const { current, onSubmit } = options;

  Alert.prompt(
    "Rename meeting",
    "This is the title everywhere the meeting appears.",
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Save",
        onPress: (value?: string) => {
          // The server trims and rejects an empty title, so trim here too and
          // treat a blank field as a cancel rather than showing an error for
          // something the user plainly did not intend.
          const next = (value ?? "").trim().slice(0, TITLE_MAX);
          if (!next || next === current.trim()) return;
          onSubmit(next);
        },
      },
    ],
    "plain-text",
    current,
  );
}
