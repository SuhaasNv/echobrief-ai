import { useInfiniteQuery } from "@tanstack/react-query";

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
  recorded_at: string | null;
  created_at: string;
  tags: string[] | null;
}

export interface MeetingListResponse {
  items: MeetingSummary[];
  total: number;
  page: number;
  limit: number;
}

const PAGE_SIZE = 20;

export const qk = {
  meetings: (search: string) => ["meetings", { search }] as const,
};

/** A meeting is still moving through the pipeline. */
export function isProcessing(status: MeetingSummary["status"]): boolean {
  return status !== "complete" && status !== "failed";
}

export function useMeetings(search = "") {
  return useInfiniteQuery({
    queryKey: qk.meetings(search),
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.apiRequest<MeetingListResponse>("/meetings", {
        query: {
          page: pageParam,
          limit: PAGE_SIZE,
          ...(search ? { q: search } : {}),
        },
      }),
    getNextPageParam: (last) =>
      last.page * last.limit < last.total ? last.page + 1 : undefined,
    // Poll only while something is actually processing. The web app polls every
    // 5s; on cellular that is four times the battery for a list-level view, so
    // the list uses 15s and the detail screen keeps the tighter loop.
    refetchInterval: (query) =>
      query.state.data?.pages.some((p) => p.items.some((m) => isProcessing(m.status)))
        ? 15_000
        : false,
  });
}
