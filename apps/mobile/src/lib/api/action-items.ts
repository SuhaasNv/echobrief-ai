import { Alert } from "react-native";
import { onlineManager, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./client";
import { describeActionFailure } from "./errors";
import { formatListDate } from "../format";
import { haptics } from "../haptics";

export interface ActionItem {
  id: string;
  meeting_id: string;
  meeting_title?: string;
  /**
   * When the source meeting happened — the server sends
   * COALESCE(meetings.recorded_at, meetings.created_at).
   *
   * Optional because a client running against an older API build will not
   * receive it; `capturedLabel` degrades to the item's own created_at and
   * changes its wording rather than passing one date off as the other.
   */
  meeting_date?: string | null;
  description: string;
  assignee_name: string | null;
  due_date: string | null;
  completed: boolean;
  /**
   * When it was completed. NULL means completed on an unknown date: items
   * finished before the API recorded this were deliberately not backfilled, so
   * there is no date to show and we must not invent one.
   */
  completed_at: string | null;
  timestamp_sec: number | null;
  created_at: string;
}

export const actionKeys = {
  all: ["action-items"] as const,
  /**
   * Scoped list. Nested under `all` so an optimistic write or an invalidation
   * against the root key still reaches every scope — the mutations all target
   * `actionKeys.all`, and a sibling key would silently stop receiving them.
   */
  scoped: (mine: boolean) => ["action-items", { mine }] as const,
  /**
   * One meeting's items. Nested under `all` for the same reason as `scoped` —
   * ticking an item off from the Actions tab writes through to this entry too,
   * so a share taken afterwards cannot paste a stale copy of the list.
   */
  forMeeting: (meetingId: string) => ["action-items", { meetingId }] as const,
};

/**
 * The endpoint returns `{ items: [...] }`, NOT a bare array.
 *
 * Typing it as ActionItem[] type-checked fine and crashed at runtime on
 * `.filter is not a function` — TypeScript cannot verify a response shape it was
 * simply told. The select unwraps it in one place so every consumer sees an
 * array, and the fallback covers the endpoint ever returning something else.
 */
interface ActionItemListResponse {
  items: ActionItem[];
}

/**
 * @param mine Narrow to commitments the signed-in user plausibly owns.
 *
 * Defaults to false, which is the whole meeting's list — "Priya will send the
 * deck" belongs on screen, because extracting every commitment from the room is
 * the product. Mine is a filter the user reaches for, not the default reading.
 */
export function useActionItems(mine = false) {
  return useQuery({
    queryKey: actionKeys.scoped(mine),
    queryFn: () =>
      api.apiRequest<ActionItemListResponse>("/action-items", {
        query: mine ? { mine: "true" } : undefined,
      }),
    select: (data): ActionItem[] => (Array.isArray(data?.items) ? data.items : []),
  });
}

/**
 * The commitments made in ONE meeting.
 *
 * Nothing on the meeting screen renders these — it has no action items pane.
 * They are fetched so the share menu can put them in the plain text it hands to
 * the clipboard and the share sheet, which is the thing the meetings empty
 * state promises ("the decisions, in a paragraph you can send") and which is
 * useless without the follow-ups.
 *
 * They live on a different endpoint from the meeting, so this is a second
 * request per meeting opened. It is a small one, it is cached for the session,
 * and the alternative — fetching at the moment Copy is tapped — would make the
 * offline path fail exactly where it is meant to work.
 */
export function useMeetingActionItems(meetingId: string) {
  return useQuery({
    queryKey: actionKeys.forMeeting(meetingId),
    queryFn: () =>
      api.apiRequest<ActionItemListResponse>("/action-items", {
        query: { meeting_id: meetingId },
      }),
    select: (data): ActionItem[] => (Array.isArray(data?.items) ? data.items : []),
  });
}

/**
 * Toggle completion optimistically.
 *
 * A checkbox that waits on a round-trip before filling in feels broken, so the
 * cache is written immediately and rolled back if the request fails. The
 * snapshot is taken after cancelling in-flight queries — otherwise a refetch
 * landing mid-mutation overwrites the optimistic value and the tick flickers
 * back off.
 *
 * The rollback has to SAY something. On its own it is indistinguishable from
 * the app undoing the user's work: the tick draws, then clears itself a moment
 * later with no explanation, and the obvious reading is that Puffin lost the
 * change on purpose. The alert names the cause and points at the retry, which
 * is the checkbox itself: PATCHing an explicit completed value is idempotent,
 * so pressing it again is always safe.
 */
export function useToggleActionItem() {
  const queryClient = useQueryClient();

  return useMutation({
    // Offline, the default network mode would PARK this mutation instead of
    // failing it, leaving the row ticked against a request that was never sent
    // and that dies with the process. Better to fail, roll back, and say so.
    networkMode: "always",

    mutationFn: ({ id, completed }: { id: string; completed: boolean }) =>
      api.apiRequest(`/action-items/${id}`, { method: "PATCH", body: { completed } }),

    onMutate: async ({ id, completed }) => {
      await queryClient.cancelQueries({ queryKey: actionKeys.all });
      // Every scope, because `mine` gives the list more than one cache entry
      // and an exact-key read would snapshot a key nothing is stored under.
      const previous = queryClient.getQueriesData<ActionItemListResponse>({
        queryKey: actionKeys.all,
      });

      // The cache holds the raw response, not the selected array.
      queryClient.setQueriesData<ActionItemListResponse>({ queryKey: actionKeys.all }, (old) =>
        old
          ? {
              ...old,
              items: old.items.map((item) =>
                item.id === id
                  ? {
                      ...item,
                      completed,
                      /**
                       * Mirror the server's rule so the row lands in its final
                       * section immediately instead of appearing under
                       * "Completed earlier" and hopping to "Today" a moment
                       * later. Re-completing an item that already has a
                       * timestamp keeps it, exactly as the API does — the
                       * optimistic value must not rewrite history either.
                       */
                      completed_at: completed
                        ? (item.completed_at ?? new Date().toISOString())
                        : null,
                    }
                  : item,
              ),
            }
          : old,
      );

      return { previous };
    },

    onError: (error, variables, context) => {
      if (context?.previous) {
        for (const [key, data] of context.previous) queryClient.setQueryData(key, data);
      }

      haptics.error();
      Alert.alert(
        variables.completed ? "That item is not checked off" : "That item is still checked off",
        `${describeActionFailure(error, { online: onlineManager.isOnline() })} Puffin put it back the way it was. Tapping it again retries.`,
      );
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: actionKeys.all });
    },
  });
}

/**
 * Delete one action item.
 *
 * Optimistic, and deliberately WITHOUT an undo window, unlike meetings. A
 * meeting is minutes of irreplaceable audio; an action item is a line of text
 * the pipeline can regenerate from the transcript it came from. Matching the
 * meeting flow here would spend a persistent veil and a timer on a row whose
 * loss costs a re-read, and it would leave a dead row occupying the list for
 * five seconds in a surface people use to clear things.
 *
 * The swipe itself is the confirmation. It is deliberate, it is reversible by
 * rolling back on failure, and it already takes a full gesture past a latch.
 */
export function useDeleteActionItem() {
  const queryClient = useQueryClient();

  return useMutation({
    // Same reasoning as the toggle above: offline this must FAIL rather than
    // park, or the row vanishes against a request that never left the device.
    networkMode: "always",

    mutationFn: ({ id }: { id: string; title: string }) =>
      api.apiRequest(`/action-items/${id}`, { method: "DELETE" }),

    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: actionKeys.all });
      // Every scope, because `mine` gives the list more than one cache entry
      // and an exact-key read would snapshot a key nothing is stored under.
      const previous = queryClient.getQueriesData<ActionItemListResponse>({
        queryKey: actionKeys.all,
      });

      queryClient.setQueriesData<ActionItemListResponse>({ queryKey: actionKeys.all }, (old) =>
        old ? { ...old, items: old.items.filter((item) => item.id !== id) } : old,
      );

      return { previous };
    },

    onError: (error, variables, context) => {
      if (context?.previous) {
        for (const [key, data] of context.previous) queryClient.setQueryData(key, data);
      }

      haptics.error();
      Alert.alert(
        "That item is still here",
        `${describeActionFailure(error, { online: onlineManager.isOnline() })} Puffin put it back. Swiping again retries.`,
      );
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: actionKeys.all });
    },
  });
}

/**
 * "When was this captured", for the Open list.
 *
 * Prefers the meeting's own date, because "captured in Monday's standup" is
 * what the user means — the item row's created_at is when our worker wrote the
 * row, which for an upload of an older recording is a different day entirely.
 *
 * When the meeting date is absent the wording changes with the meaning: "Added"
 * describes the row, "Captured" describes the conversation. Showing the row's
 * date under the word "Captured" would be a quiet lie on exactly the uploads
 * where the two dates diverge most.
 */
export function capturedLabel(item: ActionItem): string | null {
  const meetingDate = formatListDate(item.meeting_date);
  if (meetingDate) return `Captured ${meetingDate}`;

  const added = formatListDate(item.created_at);
  return added ? `Added ${added}` : null;
}

/**
 * "Completed <date>" for a done row, or a bare "Completed" when the date is
 * unknown. Never guesses: a NULL completed_at is a row finished before the API
 * recorded completion times, and it was deliberately not backfilled.
 */
export function completedLabel(item: ActionItem): string | null {
  if (!item.completed) return null;
  const date = formatListDate(item.completed_at);
  return date ? `Completed ${date}` : "Completed";
}

export type DueGroup = "Overdue" | "Today" | "This week" | "Later" | "No due date";

/**
 * Group by due date.
 *
 * The API has no due-window grouping, so this is computed client-side. Dates
 * are compared at day granularity — a task due later today is not overdue.
 */
export function groupByDue(items: ActionItem[]): { group: DueGroup; items: ActionItem[] }[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const buckets = new Map<DueGroup, ActionItem[]>([
    ["Overdue", []],
    ["Today", []],
    ["This week", []],
    ["Later", []],
    ["No due date", []],
  ]);

  for (const item of items) {
    if (!item.due_date) {
      buckets.get("No due date")?.push(item);
      continue;
    }

    const due = new Date(item.due_date);
    if (Number.isNaN(due.getTime())) {
      buckets.get("No due date")?.push(item);
      continue;
    }

    const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    const days = Math.round((dueDay.getTime() - startOfToday.getTime()) / 86_400_000);

    if (days < 0) buckets.get("Overdue")?.push(item);
    else if (days === 0) buckets.get("Today")?.push(item);
    else if (days <= 7) buckets.get("This week")?.push(item);
    else buckets.get("Later")?.push(item);
  }

  return Array.from(buckets.entries())
    .filter(([, group]) => group.length > 0)
    .map(([group, groupItems]) => ({ group, items: groupItems }));
}

export type CompletedGroup = "Today" | "Yesterday" | "This week" | "Earlier" | "Completed earlier";

/**
 * Group the Done list by completion date.
 *
 * Same wording as the meetings list — Today / Yesterday / then further back —
 * so a date means the same thing everywhere in the app.
 *
 * "Completed earlier" is the honest bucket for rows whose completed_at is NULL.
 * Those items were finished before the API recorded a completion time and were
 * deliberately not backfilled, so this group claims no date at all rather than
 * filing them under a day they may not belong to. It always sorts last.
 */
export function groupByCompleted(
  items: ActionItem[],
): { group: CompletedGroup; items: ActionItem[] }[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const buckets = new Map<CompletedGroup, ActionItem[]>([
    ["Today", []],
    ["Yesterday", []],
    ["This week", []],
    ["Earlier", []],
    ["Completed earlier", []],
  ]);

  for (const item of items) {
    const completedAt = item.completed_at ? new Date(item.completed_at) : null;
    if (!completedAt || Number.isNaN(completedAt.getTime())) {
      buckets.get("Completed earlier")?.push(item);
      continue;
    }

    const day = new Date(completedAt.getFullYear(), completedAt.getMonth(), completedAt.getDate());
    const days = Math.round((startOfToday.getTime() - day.getTime()) / 86_400_000);

    // A future timestamp (clock skew between device and server) is treated as
    // today rather than dropped into "Earlier", where it would look like a bug.
    if (days <= 0) buckets.get("Today")?.push(item);
    else if (days === 1) buckets.get("Yesterday")?.push(item);
    else if (days < 7) buckets.get("This week")?.push(item);
    else buckets.get("Earlier")?.push(item);
  }

  // Most recent first inside each group. The server already returns the Done
  // list in this order, but the mobile app fetches one mixed list and splits it
  // client-side, so the ordering is applied here too.
  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => {
      const at = a.completed_at ? Date.parse(a.completed_at) : 0;
      const bt = b.completed_at ? Date.parse(b.completed_at) : 0;
      return bt - at;
    });
  }

  return Array.from(buckets.entries())
    .filter(([, group]) => group.length > 0)
    .map(([group, groupItems]) => ({ group, items: groupItems }));
}
