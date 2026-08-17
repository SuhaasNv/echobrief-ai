import { useCallback, useSyncExternalStore } from "react";
import { Alert } from "react-native";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import { ApiError } from "@echobrief/shared/api";

import { haptics } from "@/lib/haptics";
// Imported from the leaf module rather than the @/lib/notifications barrel on
// purpose. The barrel is side-effecting by design — importing it evaluates
// ./task and ./lifecycle, which registers the background TaskManager task — and
// pulling that into the module every meetings screen imports would run
// notification plumbing far earlier and far wider than intended. src/lib/audio/
// upload.ts does exactly the same thing for exactly the same call.
import { forgetMeeting } from "@/lib/notifications/store";

import { api } from "./client";

/** Mirrors MeetingSummary in packages/shared/src/schemas.ts. */
export interface MeetingSummary {
  id: string;
  title: string;
  status: "queued" | "transcribing" | "analyzing" | "indexing" | "complete" | "failed";
  duration_sec: number | null;
  participant_count: number | null;
  action_item_count: number | null;
  summary_excerpt: string | null;
  is_favorite: boolean;
  recorded_at: string | null;
  created_at: string;
  tags: string[] | null;
  /**
   * Present only on a search response. Matched terms are wrapped in [[…]] as
   * plain text rather than HTML, because this feeds a React Native list and
   * there is no markup renderer in the row.
   */
  match_snippet?: string | null;
}

export interface MeetingListResponse {
  items: MeetingSummary[];
  total: number;
  page: number;
  limit: number;
}

const PAGE_SIZE = 20;

export const qk = {
  /** Every list variant. Prefix-matched by `qk.allMeetings` below. */
  meetings: (search: string) => ["meetings", { search }] as const,
  /** The prefix every search variant shares, for cancel / invalidate / write. */
  allMeetings: ["meetings"] as const,
  /**
   * The detail query's key.
   *
   * Declared here rather than in meeting-detail.ts because that module already
   * imports from this one; putting it the other way round would make the two
   * files circular.
   */
  meeting: (id: string) => ["meeting", id] as const,
};

/** A meeting is still moving through the pipeline. */
export function isProcessing(status: MeetingSummary["status"]): boolean {
  return status !== "complete" && status !== "failed";
}

export function useMeetings(search = "") {
  return useInfiniteQuery({
    queryKey: qk.meetings(search),
    initialPageParam: 1,
    // Filtered on the way in rather than repaired afterwards: a page fetched
    // while a DELETE is still on the wire carries the meeting the server has
    // not been told about yet, and writing that page to the cache is what puts
    // a deleted row back. See `committingDeletes` in the delete section below.
    queryFn: async ({ pageParam }) =>
      withoutCommittingDeletes(
        await api.apiRequest<MeetingListResponse>("/meetings", {
          query: {
            page: pageParam,
            limit: PAGE_SIZE,
            ...(search ? { q: search } : {}),
          },
        }),
      ),
    getNextPageParam: (last) => (last.page * last.limit < last.total ? last.page + 1 : undefined),
    // Poll only while something is actually processing. The web app polls every
    // 5s; on cellular that is four times the battery for a list-level view, so
    // the list uses 15s and the detail screen keeps the tighter loop.
    refetchInterval: (query) =>
      query.state.data?.pages.some((p) => p.items.some((m) => isProcessing(m.status)))
        ? 15_000
        : false,
  });
}

// ---------------------------------------------------------------------------
// Rename — PATCH /meetings/:id
// ---------------------------------------------------------------------------

/**
 * The server accepts `{ title }` on PATCH /meetings/:id and answers `{ ok: true }`
 * with no body worth reading, so the caches are patched rather than refetched.
 *
 * The list is deliberately NOT invalidated: it is an infinite query, and
 * invalidating it refetches every page the user has already scrolled through
 * over a cellular connection to change one string. The detail query IS
 * invalidated, because it is a single cheap request and it is the screen the
 * user is looking at.
 */
/**
 * Ask the server to process a failed meeting again.
 *
 * Exists because the audio usually survives the failure. The most common cause
 * is transient — AssemblyAI refusing a download, an OpenAI 500 partway through
 * analysis — and the recording is sitting in R2 the whole time. Before this the
 * failure card said so and offered nothing, which is the worst combination:
 * telling someone their data is fine while giving them no way to get it back.
 *
 * The server also covers the case this was written for: a SEGMENTED recording
 * that failed before its parts were joined has no `audio_key` yet, and the
 * retry route falls back to the segment objects rather than refusing.
 *
 * networkMode "always" so this fails out loud offline. A retry that parks in a
 * queue looks identical to a retry that is running, and the user is already
 * looking at a screen that says something went wrong.
 *
 * The status query is invalidated rather than written: the server decides
 * whether the retry was accepted at all — it refuses past three attempts, and
 * 409s when a worker already holds the lock — so guessing "queued" here would
 * show a progress ring for a job that was never created.
 */
export function useRetryMeeting(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    networkMode: "always",
    mutationFn: () => api.apiRequest(`/meetings/${id}/retry`, { method: "POST" }),
    onSuccess: async () => {
      haptics.tap();
      // Prefix, not exact: the status poll lives at ["meeting", id, "status"]
      // and the detail at ["meeting", id]. One non-exact invalidate catches
      // both — and the status query is the one driving the progress ring the
      // user is about to watch, so missing it would leave the screen insisting
      // the meeting is still failed.
      await queryClient.invalidateQueries({ queryKey: qk.meeting(id) });
    },
  });
}

export function useRenameMeeting(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (title: string) =>
      api.apiRequest(`/meetings/${id}`, { method: "PATCH", body: { title } }),

    onSuccess: (_data, title) => {
      // Typed structurally on the one field being written. The spread preserves
      // every other field of the real cached object; narrowing the generic here
      // only limits what this function is allowed to touch.
      queryClient.setQueryData<{ title: string }>(qk.meeting(id), (old) =>
        old ? { ...old, title } : old,
      );

      queryClient.setQueriesData<InfiniteData<MeetingListResponse>>(
        { queryKey: qk.allMeetings },
        (old) =>
          old
            ? {
                ...old,
                pages: old.pages.map((page) => ({
                  ...page,
                  items: page.items.map((m) => (m.id === id ? { ...m, title } : m)),
                })),
              }
            : old,
      );

      void queryClient.invalidateQueries({ queryKey: qk.meeting(id) });
    },
  });
}

/**
 * Star / un-star a meeting.
 *
 * Optimistic, because a favorite that lags behind the thumb reads as a missed
 * tap. It writes through the same PATCH /meetings/:id the rename uses, so the
 * SERVER owns the flag: the star shows on the web and survives a reinstall. Both
 * the detail and every cached list page are flipped at once, and snapshotted so
 * a failed write puts the star back exactly where it was.
 */
export function useToggleFavorite(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (next: boolean) =>
      api.apiRequest(`/meetings/${id}`, { method: "PATCH", body: { is_favorite: next } }),

    onMutate: async (next: boolean) => {
      // Cancel first, as every other optimistic mutation in this file does. The
      // list polls every 15s while anything is processing, and a refetch already
      // in flight carries the PRE-write flag — landing it after the optimistic
      // write flipped the star back under the user's thumb.
      await queryClient.cancelQueries({ queryKey: qk.allMeetings });
      await queryClient.cancelQueries({ queryKey: qk.meeting(id) });

      const detail = queryClient.getQueryData(qk.meeting(id));
      const lists = queryClient.getQueriesData<InfiniteData<MeetingListResponse>>({
        queryKey: qk.allMeetings,
      });

      queryClient.setQueryData<{ is_favorite: boolean }>(qk.meeting(id), (old) =>
        old ? { ...old, is_favorite: next } : old,
      );
      queryClient.setQueriesData<InfiniteData<MeetingListResponse>>(
        { queryKey: qk.allMeetings },
        (old) =>
          old
            ? {
                ...old,
                pages: old.pages.map((page) => ({
                  ...page,
                  items: page.items.map((m) => (m.id === id ? { ...m, is_favorite: next } : m)),
                })),
              }
            : old,
      );

      return { detail, lists };
    },

    onError: (_err, _next, ctx) => {
      if (!ctx) return;
      queryClient.setQueryData(qk.meeting(id), ctx.detail);
      for (const [key, data] of ctx.lists) queryClient.setQueryData(key, data);
    },

    // Reconcile with the server either way, so the cache cannot drift from a
    // write that raced another mutation.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.allMeetings });
      void queryClient.invalidateQueries({ queryKey: qk.meeting(id) });
    },
  });
}

// ---------------------------------------------------------------------------
// Delete — DELETE /meetings/:id, deferred behind a real undo window
// ---------------------------------------------------------------------------

/**
 * Deletion is genuinely deferred, not fired and reverted.
 *
 * DELETE /meetings/:id destroys the audio object in R2 and cascades the row
 * away. There is no server-side restore, so an "undo" that fires the request
 * immediately and then re-creates a row from a cache snapshot would be a lie:
 * the recording would already be gone. So the request does not leave the device
 * until the undo window closes.
 *
 * The registry lives at module scope rather than in a component because the
 * commit has to survive the row unmounting — the user deletes from the detail
 * screen and immediately navigates back, or scrolls the row out of a
 * virtualized list. A `useMutation` tied to a screen would be torn down first.
 *
 * The QueryClient is passed in by the caller (which has it from context) rather
 * than reached for globally, so there is exactly one client and no import cycle
 * back into the provider.
 */
export const DELETE_UNDO_MS = 5_000;

interface PendingDelete {
  title: string;
  timer: ReturnType<typeof setTimeout>;
}

const pendingDeletes = new Map<string, PendingDelete>();
const pendingListeners = new Set<() => void>();

function notifyPendingChanged(): void {
  for (const listener of pendingListeners) listener();
}

function subscribeToPending(onChange: () => void): () => void {
  pendingListeners.add(onChange);
  return () => {
    pendingListeners.delete(onChange);
  };
}

/**
 * True while `id` is inside its undo window.
 *
 * Subscribed per id so the snapshot is a boolean. Returning the Map itself
 * would defeat useSyncExternalStore's Object.is check — the Map is mutated in
 * place, so its identity never changes and nothing would ever re-render.
 */
export function useMeetingDeletePending(id: string): boolean {
  const getSnapshot = useCallback(() => pendingDeletes.has(id), [id]);
  return useSyncExternalStore(subscribeToPending, getSnapshot, getSnapshot);
}

/**
 * Start the undo window. The row stays in the cache untouched for the whole
 * window: nothing has happened yet, so there is nothing to roll back if the
 * user changes their mind or the app is killed.
 */
export function scheduleMeetingDelete(id: string, title: string, queryClient: QueryClient): void {
  if (pendingDeletes.has(id)) return;

  const timer = setTimeout(() => {
    void commitMeetingDelete(id, queryClient);
  }, DELETE_UNDO_MS);

  pendingDeletes.set(id, { title, timer });
  notifyPendingChanged();
}

/** Cancel before the window closes. No request was sent, so this is free. */
export function undoMeetingDelete(id: string): void {
  const entry = pendingDeletes.get(id);
  if (!entry) return;

  clearTimeout(entry.timer);
  pendingDeletes.delete(id);
  notifyPendingChanged();
}

/**
 * Ids whose DELETE is on the wire right now.
 *
 * The request is not instant: the server destroys the R2 audio object before it
 * touches the row, so for as long as it is in flight `/meetings` still answers
 * WITH the meeting. Any list fetch that starts in that window — the 15s poll,
 * a pull to refresh, a return to the foreground — lands on top of the
 * optimistic write below and puts the row, and the `total` the stat header
 * reads, straight back. The `cancelQueries` at the top of the commit guards the
 * optimistic write; nothing guarded the window around the request itself, and
 * the invalidation at the end only repairs it a round trip later.
 *
 * Deliberately NOT the same thing as `pendingDeletes`. During the undo window
 * nothing has been sent, the meeting is still real, and a refetch that carries
 * it is telling the truth — the row is hidden by the veil, not by the cache.
 */
const committingDeletes = new Set<string>();

/** Drops meetings whose DELETE is in flight from a list page as it lands. */
function withoutCommittingDeletes(page: MeetingListResponse): MeetingListResponse {
  if (committingDeletes.size === 0) return page;

  const items = page.items.filter((m) => !committingDeletes.has(m.id));
  // Returning the original object keeps its reference stable for the common
  // case where nothing on this page is being deleted.
  if (items.length === page.items.length) return page;

  // `total` is a count of the whole collection repeated on every page, so it
  // comes down by the same number the page lost — same reason the optimistic
  // write below decrements every page rather than just the one that held the row.
  return {
    ...page,
    items,
    total: Math.max(0, page.total - (page.items.length - items.length)),
  };
}

async function commitMeetingDelete(id: string, queryClient: QueryClient): Promise<void> {
  const entry = pendingDeletes.get(id);
  // Undone in the gap between the timer firing and this running.
  if (!entry) return;

  const { title } = entry;
  pendingDeletes.delete(id);
  notifyPendingChanged();

  // Cancel FIRST, then snapshot. Snapshotting before the cancel captures state
  // that an in-flight refetch is about to overwrite, and that refetch — which
  // still carries the meeting, because the server has not been told yet —
  // lands after the optimistic write and puts the row straight back.
  await queryClient.cancelQueries({ queryKey: qk.allMeetings });

  const snapshot = queryClient.getQueriesData<InfiniteData<MeetingListResponse>>({
    queryKey: qk.allMeetings,
  });

  queryClient.setQueriesData<InfiniteData<MeetingListResponse>>(
    { queryKey: qk.allMeetings },
    (old) => {
      if (!old) return old;

      let removed = false;
      const pages = old.pages.map((page) => {
        const items = page.items.filter((m) => m.id !== id);
        // Same length means this page never held the row; returning the original
        // object keeps its reference stable so untouched pages do not re-render.
        if (items.length === page.items.length) return page;
        removed = true;
        return { ...page, items };
      });

      if (!removed) return old;

      // `total` is a count of the whole collection repeated on every page, not a
      // per-page figure. Decrementing only the page that held the row leaves the
      // list header — which reads page[0].total — reporting a meeting that is no
      // longer there whenever the deleted row was on page two or later.
      return {
        ...old,
        pages: pages.map((page) => ({ ...page, total: Math.max(0, page.total - 1) })),
      };
    },
  );

  committingDeletes.add(id);

  try {
    await api.apiRequest(`/meetings/${id}`, { method: "DELETE" });
  } catch (error) {
    // 404 is success in disguise. The endpoint scopes by user_id and
    // workspace_id, so "already deleted" and "not yours" are the same response,
    // and in both cases the row must stay gone — restoring it would put a
    // meeting in the library that cannot be opened.
    const alreadyGone = error instanceof ApiError && error.status === 404;

    if (!alreadyGone) {
      // Restore from the snapshot first: it is immediate and it works offline,
      // which matters because "no network" is the most likely reason this
      // failed. Then invalidate to reconcile with the server once it is
      // reachable again — that also repairs the rare case where a second delete
      // committed between this snapshot and this restore, whose removal the
      // snapshot would otherwise undo.
      for (const [key, data] of snapshot) {
        if (data !== undefined) queryClient.setQueryData(key, data);
      }
      void queryClient.invalidateQueries({ queryKey: qk.allMeetings });

      haptics.error();
      Alert.alert(
        "Could not delete that meeting",
        `"${title}" is still in your library. ${
          error instanceof Error
            ? error.message
            : "The request didn’t complete. Nothing changed — try again."
        }`,
      );
      return;
    }
  } finally {
    // In a finally so no path can leave an id on the list: one stuck there
    // would hide a real meeting from every subsequent list fetch for the life
    // of the process. It runs after the catch body, so the reconciling
    // invalidation above still refetches unfiltered — that response lands long
    // after this line.
    committingDeletes.delete(id);
  }

  // The detail query is removed rather than invalidated: invalidating refetches
  // a row that no longer exists and lands the detail screen on a 404.
  queryClient.removeQueries({ queryKey: qk.meeting(id) });
  void queryClient.invalidateQueries({ queryKey: qk.allMeetings });

  // Drop the notification dedupe record. Without this the "already notified"
  // ledger grows for the life of the install and never sheds ids that can never
  // notify again.
  void forgetMeeting(id).catch(() => {
    // Best effort. A stale ledger entry is a leak, not a failure the user can
    // act on, and surfacing it after a successful delete would be noise.
  });
}
