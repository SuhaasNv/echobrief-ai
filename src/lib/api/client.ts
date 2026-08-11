/**
 * Typed API client.
 *
 * Wraps `fetch` with auth token injection, JSON parsing, and structured error
 * shapes. All paths are relative to /api/v1.
 */

/** Every API route lives under this prefix (see src/api.ts: app.route("/api/v1", api)). */
const API_PATH_PREFIX = "/api/v1";

/**
 * Accepts an origin with or without the /api/v1 suffix and always returns one
 * that has it. VITE_API_URL is baked into the client bundle at image build
 * time, so a bare origin there would otherwise 404 outside the mount — which
 * the browser reports as a CORS failure, not a 404.
 */
function normalizeApiBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return API_PATH_PREFIX;
  return trimmed.endsWith(API_PATH_PREFIX) ? trimmed : `${trimmed}${API_PATH_PREFIX}`;
}

const API_BASE_URL = normalizeApiBaseUrl(
  (typeof window !== "undefined" &&
    (window as { __ECHOBRIEF_API_URL__?: string }).__ECHOBRIEF_API_URL__) ||
    (import.meta.env?.VITE_API_URL as string | undefined) ||
    API_PATH_PREFIX,
);

const TOKEN_STORAGE_KEY = "echobrief-auth-token";
const WORKSPACE_STORAGE_KEY = "echobrief-active-workspace";

export function setAuthToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
  else localStorage.removeItem(TOKEN_STORAGE_KEY);
}

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setActiveWorkspaceId(id: string | null): void {
  if (typeof window === "undefined") return;
  if (id) localStorage.setItem(WORKSPACE_STORAGE_KEY, id);
  else localStorage.removeItem(WORKSPACE_STORAGE_KEY);
}

export function getActiveWorkspaceId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(WORKSPACE_STORAGE_KEY);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
  /** If true, returns the raw Response for streaming consumers. */
  raw?: boolean;
}

export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  return apiRequestInternal<T>(path, opts, false);
}

async function apiRequestInternal<T>(
  path: string,
  opts: RequestOptions,
  isRetry: boolean,
): Promise<T> {
  const url = new URL(
    `${API_BASE_URL}${path}`,
    typeof window !== "undefined" ? window.location.origin : "http://localhost",
  );
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  const token = getAuthToken();
  if (token) headers.authorization = `Bearer ${token}`;
  const workspaceId = getActiveWorkspaceId();
  if (workspaceId) headers["x-workspace-id"] = workspaceId;

  const response = await fetch(url.toString(), {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });

  if (!response.ok) {
    // Read the error payload off a clone so a `raw` caller (apiStream) still
    // gets an unconsumed body to parse. This block runs BEFORE the raw
    // early-return so streaming endpoints get the same self-heal and
    // session-expiry handling as everything else.
    let payload: { error?: string; message?: string; details?: unknown } = {};
    try {
      payload = await (opts.raw ? response.clone() : response).json();
    } catch {
      /* response not JSON */
    }

    // Self-heal stale workspace ID: if the middleware says we're not a member
    // of the workspace we're asking about, our localStorage is from a previous
    // session. Clear it, notify listeners, and retry once — the next request
    // omits the header and the server falls back to the user's first workspace.
    if (
      !isRetry &&
      response.status === 403 &&
      workspaceId &&
      typeof payload.message === "string" &&
      /not a member of this workspace/i.test(payload.message)
    ) {
      setActiveWorkspaceId(null);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("echobrief:workspace-changed", { detail: null }));
      }
      return apiRequestInternal<T>(path, opts, true);
    }

    // The token is present but the server rejected it — expired, revoked, or
    // signed with a rotated secret. Without this the app keeps a dead token in
    // localStorage forever: the /app guard sees a non-empty string and lets the
    // shell mount, every query 401s, and there is no route back to /login.
    // /auth/* is exempt — a 401 there is just wrong credentials.
    if (response.status === 401 && !path.startsWith("/auth/")) {
      setAuthToken(null);
      setActiveWorkspaceId(null);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("echobrief:unauthorized"));
      }
    }

    // Raw callers parse and throw their own error from the untouched body.
    if (opts.raw) return response as unknown as T;

    throw new ApiError(
      response.status,
      payload.error ?? "http_error",
      payload.message ?? response.statusText,
      payload.details,
    );
  }

  if (opts.raw) return response as unknown as T;

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/**
 * Streaming helper for AI endpoints (chat, search, generate/email).
 * Yields decoded text chunks as they arrive. Headers (e.g. `x-citations`) are
 * available via the returned `response` object.
 */
export async function apiStream(
  path: string,
  opts: Omit<RequestOptions, "raw"> = {},
): Promise<{ stream: AsyncGenerator<string>; response: Response }> {
  const response = (await apiRequest<Response>(path, { ...opts, raw: true })) as Response;
  if (!response.ok) {
    let payload: { error?: string; message?: string } = {};
    try {
      payload = await response.json();
    } catch {
      /* not JSON */
    }
    throw new ApiError(
      response.status,
      payload.error ?? "http_error",
      payload.message ?? response.statusText,
    );
  }

  const stream = (async function* () {
    if (!response.body) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        yield decoder.decode(value, { stream: true });
      }
    } finally {
      reader.releaseLock();
    }
  })();

  return { stream, response };
}
