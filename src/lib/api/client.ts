/**
 * Typed API client.
 *
 * Wraps `fetch` with auth token injection, JSON parsing, and structured error
 * shapes. All paths are relative to /api/v1.
 */

const API_BASE_URL =
  (typeof window !== "undefined" && (window as { __ECHOBRIEF_API_URL__?: string }).__ECHOBRIEF_API_URL__) ||
  (import.meta.env?.VITE_API_URL as string | undefined) ||
  "/api/v1";

const TOKEN_STORAGE_KEY = "echobrief-auth-token";

export function setAuthToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
  else localStorage.removeItem(TOKEN_STORAGE_KEY);
}

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_STORAGE_KEY);
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
  const url = new URL(`${API_BASE_URL}${path}`, typeof window !== "undefined" ? window.location.origin : "http://localhost");
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

  const response = await fetch(url.toString(), {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });

  if (opts.raw) return response as unknown as T;

  if (!response.ok) {
    let payload: { error?: string; message?: string; details?: unknown } = {};
    try {
      payload = await response.json();
    } catch {
      /* response not JSON */
    }
    throw new ApiError(
      response.status,
      payload.error ?? "http_error",
      payload.message ?? response.statusText,
      payload.details,
    );
  }

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
