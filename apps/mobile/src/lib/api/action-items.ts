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

export function useActionItems() {
  return useQuery({
    queryKey: actionKeys.all,
    queryFn: () => api.apiRequest<ActionItemListResponse>("/action-items"),
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
 * later with no explanation, and the obvious reading is that EchoBrief lost the
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
      const previous = queryClient.getQueryData<ActionItemListResponse>(actionKeys.all);

      // The cache holds the raw response, not the selected array.
      queryClient.setQueryData<ActionItemListResponse>(actionKeys.all, (old) =>
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
        queryClient.setQueryData(actionKeys.all, context.previous);
      }

      haptics.error();
      Alert.alert(
        variables.completed ? "That item is not checked off" : "That item is still checked off",
        `${describeActionFailure(error, { online: onlineManager.isOnline() })} EchoBrief put it back the way it was. Tapping it again retries.`,
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

    const day = new Date(
      completedAt.getFullYear(),
      completedAt.getMonth(),
      completedAt.getDate(),
    );
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
