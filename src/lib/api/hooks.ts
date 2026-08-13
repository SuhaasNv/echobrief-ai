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
  workspaces: ["workspaces"] as const,
};

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------
export type WorkspaceColor = "brand" | "violet" | "emerald" | "amber" | "rose" | "slate";
export type WorkspaceKind = "student" | "professional";

export interface Workspace {
  id: string;
  name: string;
  color: WorkspaceColor;
  kind: WorkspaceKind;
  owner_id: string;
  created_at: string;
}

export function useWorkspaces() {
  return useQuery({
    queryKey: qk.workspaces,
    queryFn: () => apiRequest<{ items: Workspace[] }>("/workspaces"),
  });
}

export function useCreateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; color?: WorkspaceColor; kind?: WorkspaceKind }) =>
      apiRequest<Workspace>("/workspaces", { method: "POST", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.workspaces }),
  });
}

export function useUpdateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...patch
    }: {
      id: string;
      name?: string;
      color?: WorkspaceColor;
      kind?: WorkspaceKind;
    }) => apiRequest<{ ok: true }>(`/workspaces/${id}`, { method: "PATCH", body: patch }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.workspaces }),
  });
}

export function useDeleteWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<{ ok: true }>(`/workspaces/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.workspaces }),
  });
}

// ---------------------------------------------------------------------------
// Flashcards (student workspaces only)
// ---------------------------------------------------------------------------
export interface Flashcard {
  id: string;
  meeting_id: string;
  workspace_id: string;
  user_id: string;
  question: string;
  answer: string;
  difficulty: "easy" | "medium" | "hard" | null;
  last_reviewed_at: string | null;
  review_count: number;
  created_at: string;
}

export interface FlashcardWithMeeting extends Flashcard {
  meeting_title: string;
}

export function useFlashcards(meetingId: string | undefined) {
  return useQuery({
    queryKey: ["flashcards", "meeting", meetingId] as const,
    queryFn: () => apiRequest<{ items: Flashcard[] }>(`/meetings/${meetingId}/flashcards`),
    enabled: !!meetingId,
  });
}

export function useGenerateFlashcards() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (meetingId: string) =>
      apiRequest<{ items: Flashcard[]; cost_usd: number }>(
        `/meetings/${meetingId}/flashcards/generate`,
        { method: "POST", body: {} },
      ),
    onSuccess: (_data, meetingId) => {
      qc.invalidateQueries({ queryKey: ["flashcards", "meeting", meetingId] });
      qc.invalidateQueries({ queryKey: ["flashcards", "review"] });
    },
  });
}

export function useReviewQueue(limit = 30) {
  return useQuery({
    queryKey: ["flashcards", "review", limit] as const,
    queryFn: () =>
      apiRequest<{ items: FlashcardWithMeeting[] }>(`/flashcards/review`, {
        query: { limit },
      }),
  });
}

export function useUpdateFlashcard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      question?: string;
      answer?: string;
      difficulty?: "easy" | "medium" | "hard";
      mark_reviewed?: boolean;
    }) => apiRequest<{ ok: true }>(`/flashcards/${id}`, { method: "PATCH", body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["flashcards"] });
    },
  });
}

export function useDeleteFlashcard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<{ ok: true }>(`/flashcards/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["flashcards"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Live streaming (Universal-Streaming token broker + live meeting save)
// ---------------------------------------------------------------------------
export interface StreamingTokenResponse {
  token: string;
  ws_url: string;
  expires_at: string;
}

/**
 * Fetch a short-lived AssemblyAI streaming token. The browser uses this to
 * open a WebSocket directly to AssemblyAI without ever seeing the API key.
 */
export async function fetchStreamingToken(): Promise<StreamingTokenResponse> {
  return apiRequest<StreamingTokenResponse>("/streaming/token", {
    method: "POST",
    body: {},
  });
}

export interface CreateLiveMeetingBody {
  title: string;
  transcript_text: string;
  audio_key: string;
  audio_size: number;
  audio_mime: string;
  duration_sec: number;
  language?: string;
  tags?: string[];
}

export function useCreateLiveMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateLiveMeetingBody) =>
      apiRequest<{ meeting_id: string; status: "queued" }>("/meetings/from-live", {
        method: "POST",
        body,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meetings"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------
export interface AccountMe {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  is_admin: boolean;
  default_account_type: "student" | "professional" | null;
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
  tier: string | null;
  subscription_status: string | null;
  stripe_customer_id: string | null;
  billing_interval: string | null;
  current_period_end: Date | null;
  price_usd: number | null;
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
  counts: {
    waiting?: number;
    active?: number;
    completed?: number;
    failed?: number;
    delayed?: number;
  };
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

// ---------------------------------------------------------------------------
// Billing — revenue, and comping accounts
// ---------------------------------------------------------------------------

export interface AdminBillingMetrics {
  subscriptions: { paying: number; comped: number; cancelling: number; grace: number };
  revenue: {
    mrr_usd: number;
    arr_usd: number;
    net_after_apple_usd: number;
    cost_usd: number;
    margin_usd: number;
  };
  users: { total: number; new_30d: number; active_30d: number };
  meetings: { total: number; last_30d: number; failed_30d: number; minutes_30d: number };
  usage_this_period: { transcription_minutes: number };
}

export interface AdminSubscriptionRow {
  user_id: string;
  email: string;
  name: string | null;
  tier: string;
  status: string;
  provider: string;
  billing_interval: string | null;
  current_period_end: string | null;
  auto_renew: boolean;
  granted_reason: string | null;
  granted_by_email: string | null;
}

export function useAdminBillingMetrics() {
  return useQuery({
    queryKey: ["admin", "billing", "metrics"] as const,
    queryFn: () => apiRequest<AdminBillingMetrics>("/admin/billing/metrics"),
    // 30s, not 10s. These are money figures read by a person deciding something,
    // not a liveness indicator — a number that reshuffles while you are reading
    // it is harder to trust, not fresher.
    refetchInterval: 30_000,
  });
}

export function useAdminSubscriptions() {
  return useQuery({
    queryKey: ["admin", "billing", "subscriptions"] as const,
    queryFn: () =>
      apiRequest<{ subscriptions: AdminSubscriptionRow[] }>("/admin/billing/subscriptions"),
    refetchInterval: 30_000,
  });
}

export function useGrantTier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { user_id: string; tier: string; reason: string }) =>
      apiRequest<{ ok: true; email: string; tier: string }>("/admin/billing/grant", {
        method: "POST",
        body,
      }),
    // Both billing queries AND the user list: the users table shows tier, so
    // leaving it stale means the grant appears to have failed on the screen the
    // admin was just looking at.
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "billing"] });
      void qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}

export function useRevokeTier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { user_id: string; reason: string }) =>
      apiRequest<{ ok: true; tier: string }>("/admin/billing/revoke", { method: "POST", body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "billing"] });
      void qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      userId,
      updates,
    }: {
      userId: string;
      updates: { name?: string; is_admin?: boolean };
    }) => apiRequest<{ ok: true }>(`/admin/users/${userId}`, { method: "PATCH", body: updates }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
  });
}

export function useUpdateUserSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      userId,
      updates,
    }: {
      userId: string;
      updates: {
        tier: "free" | "student" | "pro" | "team";
        status?: "active" | "cancelled" | "past_due" | "trialing";
      };
    }) =>
      apiRequest<{ ok: true }>(`/admin/users/${userId}/subscription`, {
        method: "PATCH",
        body: updates,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, confirm = false }: { userId: string; confirm?: boolean }) =>
      apiRequest<{ ok: true; deleted_email: string }>(
        `/admin/users/${userId}${confirm ? "?confirm=true" : ""}`,
        {
          method: "DELETE",
        },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
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
    queryFn: () =>
      apiRequest<MeetingListResponse>("/meetings", {
        query: query as Record<string, string | number>,
      }),
    // Poll while anything on the page is still processing. Without this the
    // inline progress bar and shimmer animate on every processing card but
    // never advance — the list was fetched once and nothing refetched it, so
    // the motion was purely decorative until a window-focus refetch.
    // Terminal-only pages don't poll at all.
    refetchInterval: (q) => {
      const data = q.state.data as MeetingListResponse | undefined;
      if (!data) return false;
      return data.items.some((m) => m.status !== "complete" && m.status !== "failed")
        ? 5000
        : false;
    },
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

/**
 * Put human names on diarized voices for one meeting.
 *
 * Invalidates the meeting detail so every transcript segment re-renders with
 * the new name — the server resolves labels on read, so nothing is rewritten
 * in the stored transcript.
 */
export function useRenameSpeakers(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (names: Record<string, string>) =>
      apiRequest<{ ok: true; names: Record<string, string> }>(`/meetings/${id}/speakers`, {
        method: "PATCH",
        body: { names },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.meeting(id) });
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
  filters: {
    completed?: boolean;
    meeting_id?: string;
    assignee?: string;
    due_before?: string;
  } = {},
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
    mutationFn: (id: string) =>
      apiRequest<{ ok: true }>(`/action-items/${id}`, { method: "DELETE" }),
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
export async function streamMeetingChat(
  id: string,
  body: MeetingChatRequest,
  signal?: AbortSignal,
) {
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
