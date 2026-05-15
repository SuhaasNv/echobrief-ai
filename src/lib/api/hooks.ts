/**
 * Typed TanStack Query hooks per endpoint group.
 *
 * Each hook wraps a single API endpoint with proper caching keys + invalidation.
 * Pages should call these directly — never call apiRequest from a component.
 */

import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { apiRequest, apiStream, ApiError } from "./client";
import type {
  MeetingListQuery,
  MeetingListResponse,
  MeetingDetail,
  MeetingStatusResponse,
  MeetingPatchRequest,
  UploadUrlRequest,
  UploadUrlResponse,
  TranscriptUploadRequest,
  TranscriptUploadResponse,
  ActionItem,
  ActionItemPatchRequest,
  ActionItemExportRequest,
  MeetingChatRequest,
  SearchRequest,
  SearchCitation,
  EmailGenerationRequest,
  UpdateProfileRequest,
} from "@/lib/schemas";

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------
export const qk = {
  account: ["account", "me"] as const,
  meetings: (q?: Partial<MeetingListQuery>) => ["meetings", q ?? {}] as const,
  meeting: (id: string) => ["meeting", id] as const,
  meetingStatus: (id: string) => ["meeting", id, "status"] as const,
  actionItems: (filters?: Record<string, unknown>) => ["action-items", filters ?? {}] as const,
  integrations: ["integrations"] as const,
};

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------
export interface AccountMe {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  is_admin: boolean;
  created_at: string;
}

export interface AdminUserRow {
  id: string;
  email: string;
  name: string | null;
  is_admin: boolean;
  has_password: boolean;
  meeting_count: number;
  created_at: string;
}

export interface AdminMeetingRow {
  id: string;
  title: string;
  status: string;
  duration_sec: number | null;
  failure_reason: string | null;
  user_email: string;
  created_at: string;
}

export interface AdminQueueResponse {
  counts: { waiting?: number; active?: number; completed?: number; failed?: number; delayed?: number };
  recent_failed: Array<{
    id: string;
    name: string;
    failed_reason: string | null;
    attempts_made: number;
    failed_at: string | null;
  }>;
}

export function useAdminUsers() {
  return useQuery({
    queryKey: ["admin", "users"] as const,
    queryFn: () => apiRequest<{ items: AdminUserRow[] }>("/admin/users"),
  });
}

export function useAdminMeetings() {
  return useQuery({
    queryKey: ["admin", "meetings"] as const,
    queryFn: () => apiRequest<{ items: AdminMeetingRow[] }>("/admin/meetings"),
  });
}

export function useAdminQueue() {
  return useQuery({
    queryKey: ["admin", "queue"] as const,
    queryFn: () => apiRequest<AdminQueueResponse>("/admin/queue"),
    refetchInterval: 5000,
  });
}

export interface AdminSystemResponse {
  services: Array<{
    name: string;
    status: "ok" | "fail" | "skipped";
    latency_ms: number | null;
    detail?: string;
  }>;
  runtime: {
    node_version: string;
    uptime_seconds: number;
    env: string;
    app_url: string;
    api_port: number;
    pid: number;
    memory_mb: number;
  };
}

export function useAdminSystem() {
  return useQuery({
    queryKey: ["admin", "system"] as const,
    queryFn: () => apiRequest<AdminSystemResponse>("/admin/system"),
    refetchInterval: 10000,
  });
}

export function useMe(options?: UseQueryOptions<AccountMe, ApiError>) {
  return useQuery({
    queryKey: qk.account,
    queryFn: () => apiRequest<AccountMe>("/account/me"),
    ...options,
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateProfileRequest) =>
      apiRequest<{ ok: true }>("/account/me", { method: "PATCH", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.account }),
  });
}

export interface ChangePasswordRequest {
  current_password: string;
  new_password: string;
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (body: ChangePasswordRequest) =>
      apiRequest<{ ok: true }>("/account/password", { method: "POST", body }),
  });
}

export function useDeleteAccount() {
  return useMutation({
    mutationFn: () => apiRequest<{ ok: true }>("/account/me", { method: "DELETE" }),
  });
}

// ---------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------
export function useMeetings(query: Partial<MeetingListQuery> = {}) {
  return useQuery({
    queryKey: qk.meetings(query),
    queryFn: () => apiRequest<MeetingListResponse>("/meetings", { query: query as Record<string, string | number> }),
  });
}

export function useMeeting(id: string | undefined) {
  return useQuery({
    queryKey: qk.meeting(id ?? ""),
    queryFn: () => apiRequest<MeetingDetail>(`/meetings/${id}`),
    enabled: !!id,
  });
}

export interface MeetingAudioUrlResponse {
  url: string;
  mime: string | null;
  expires_at: string;
}

export function useMeetingAudioUrl(id: string | undefined) {
  return useQuery({
    queryKey: ["meeting", id ?? "", "audio-url"] as const,
    queryFn: () => apiRequest<MeetingAudioUrlResponse>(`/meetings/${id}/audio-url`),
    enabled: !!id,
    // Refresh before the 30-min signed URL expires.
    staleTime: 25 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

/** Poll a meeting's processing status. Auto-stops once status === complete. */
export function useMeetingStatus(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.meetingStatus(id ?? ""),
    queryFn: () => apiRequest<MeetingStatusResponse>(`/meetings/${id}/status`),
    enabled: !!id && enabled,
    refetchInterval: (q) => {
      const data = q.state.data as MeetingStatusResponse | undefined;
      if (!data) return 5000;
      return data.status === "complete" || data.status === "failed" ? false : 5000;
    },
  });
}

export function useUploadUrl() {
  return useMutation({
    mutationFn: (body: UploadUrlRequest) =>
      apiRequest<UploadUrlResponse>("/meetings/upload-url", { method: "POST", body }),
  });
}

export function useUploadTranscript() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TranscriptUploadRequest) =>
      apiRequest<TranscriptUploadResponse>("/meetings/from-transcript", {
        method: "POST",
        body,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["meetings"] }),
  });
}

export function useConfirmUpload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (meeting_id: string) =>
      apiRequest<{ meeting_id: string; status: "queued" }>("/meetings", {
        method: "POST",
        body: { meeting_id },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["meetings"] }),
  });
}

export function usePatchMeeting(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: MeetingPatchRequest) =>
      apiRequest<{ ok: true }>(`/meetings/${id}`, { method: "PATCH", body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.meeting(id) });
      qc.invalidateQueries({ queryKey: ["meetings"] });
    },
  });
}

export function useDeleteMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<{ ok: true }>(`/meetings/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["meetings"] }),
  });
}

export function useRetryMeeting(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest<{ ok: true }>(`/meetings/${id}/retry`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.meeting(id) });
      qc.invalidateQueries({ queryKey: qk.meetingStatus(id) });
    },
  });
}

export function useShareMeeting(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) =>
      apiRequest<{ share_token: string | null; share_url: string | null }>(
        `/meetings/${id}/share`,
        { method: "POST", body: { enabled } },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.meeting(id) }),
  });
}

// ---------------------------------------------------------------------------
// Action items
// ---------------------------------------------------------------------------
export function useActionItems(
  filters: { completed?: boolean; meeting_id?: string; assignee?: string; due_before?: string } = {},
) {
  return useQuery({
    queryKey: qk.actionItems(filters as Record<string, unknown>),
    queryFn: () =>
      apiRequest<{ items: ActionItem[] }>("/action-items", {
        query: {
          ...(filters.completed !== undefined ? { completed: String(filters.completed) } : {}),
          ...(filters.meeting_id ? { meeting_id: filters.meeting_id } : {}),
          ...(filters.assignee ? { assignee: filters.assignee } : {}),
          ...(filters.due_before ? { due_before: filters.due_before } : {}),
        },
      }),
  });
}

export function usePatchActionItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ActionItemPatchRequest }) =>
      apiRequest<{ ok: true }>(`/action-items/${id}`, { method: "PATCH", body: patch }),
    // Optimistic update: patch the cache instantly, snapshot for rollback.
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ["action-items"] });
      const snapshot = qc.getQueriesData<{ items: ActionItem[] }>({ queryKey: ["action-items"] });
      qc.setQueriesData<{ items: ActionItem[] }>({ queryKey: ["action-items"] }, (old) => {
        if (!old) return old;
        return {
          ...old,
          items: old.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
        };
      });
      return { snapshot };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["action-items"] }),
  });
}

export function useDeleteActionItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<{ ok: true }>(`/action-items/${id}`, { method: "DELETE" }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["action-items"] });
      const snapshot = qc.getQueriesData<{ items: ActionItem[] }>({ queryKey: ["action-items"] });
      qc.setQueriesData<{ items: ActionItem[] }>({ queryKey: ["action-items"] }, (old) => {
        if (!old) return old;
        return { ...old, items: old.items.filter((i) => i.id !== id) };
      });
      return { snapshot };
    },
    onError: (_err, _id, ctx) => {
      ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["action-items"] }),
  });
}

export function useExportActionItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ActionItemExportRequest }) =>
      apiRequest<{ provider: string; external_id: string; external_url: string | null }>(
        `/action-items/${id}/export`,
        { method: "POST", body },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["action-items"] }),
  });
}

// ---------------------------------------------------------------------------
// AI streaming endpoints
// ---------------------------------------------------------------------------
export async function streamMeetingChat(id: string, body: MeetingChatRequest, signal?: AbortSignal) {
  return apiStream(`/meetings/${id}/chat`, { method: "POST", body, signal });
}

export async function streamSearch(body: SearchRequest, signal?: AbortSignal) {
  const result = await apiStream("/search", { method: "POST", body, signal });
  // Citations are sent in a response header to keep the streamed body pure text.
  const raw = result.response.headers.get("x-citations");
  const citations: SearchCitation[] = raw ? JSON.parse(decodeURIComponent(raw)) : [];
  return { ...result, citations };
}

export async function streamEmail(body: EmailGenerationRequest) {
  return apiStream("/generate/email", { method: "POST", body });
}

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------
export function useIntegrations() {
  return useQuery({
    queryKey: qk.integrations,
    queryFn: () =>
      apiRequest<{
        items: Array<{ provider: string; workspace_name: string | null; created_at: string }>;
      }>("/integrations"),
  });
}
