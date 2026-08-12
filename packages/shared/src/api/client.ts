/**
 * Platform-agnostic API client factory.
 *
 * The web client reads its token synchronously from localStorage and signals
 * session events by dispatching DOM CustomEvents. Neither exists in React
 * Native, so those five touchpoints are injected instead of imported:
 * base URL, token/workspace read+write, and the two session callbacks.
 *
 * Everything else — query building, header assembly, the stale-workspace
 * self-heal, the 401 session clear, and ApiError — is identical on both
 * platforms and lives here.
 *
 * `getToken()` is deliberately SYNCHRONOUS. iOS Keychain reads are async, so
 * the native adapter hydrates an in-memory cache once at boot and writes
 * through on change. Making it async would force every call site in hooks.ts
 * to become async and would defeat the point of sharing this file.
 */

/** Every API route lives under this prefix (see src/api.ts: app.route("/api/v1", api)). */
export const API_PATH_PREFIX = "/api/v1";

/**
 * Accepts an origin with or without the /api/v1 suffix and always returns one
 * that has it. The base URL is baked in at build time on both platforms
 * (VITE_API_URL on web, EXPO_PUBLIC_API_URL on native), so a bare origin would
 * otherwise 404 outside the mount — which a browser reports as a CORS failure
 * rather than a 404, and which native reports as an opaque parse error.
 */
export function normalizeApiBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return API_PATH_PREFIX;
  return trimmed.endsWith(API_PATH_PREFIX) ? trimmed : `${trimmed}${API_PATH_PREFIX}`;
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

/**
 * Synchronous access to the two values every request needs.
 *
 * Web backs this with localStorage directly. Native backs it with a module
 * variable hydrated from expo-secure-store during splash, writing through to
 * the Keychain on every set.
 */
export interface TokenStore {
  getToken(): string | null;
  setToken(token: string | null): void;
  getWorkspaceId(): string | null;
  setWorkspaceId(id: string | null): void;
}

export interface ApiClientConfig {
  /** Origin, with or without the /api/v1 suffix. */
  baseUrl: string;
  store: TokenStore;
  /** Session is dead — route to sign-in. Web dispatches a CustomEvent; native calls a store action. */
  onUnauthorized?: () => void;
  /** A stale workspace id was cleared; refetch anything workspace-scoped. */
  onWorkspaceReset?: () => void;
  /**
   * Native must pass `fetch` from 'expo/fetch' explicitly rather than relying
   * on the global. React Native's built-in fetch is an XHR polyfill whose
   * `response.body` is undefined, which would break every streaming endpoint.
   */
  fetchImpl?: typeof globalThis.fetch;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
  /** If true, returns the raw Response for streaming consumers. */
  raw?: boolean;
}

export interface ApiClient {
  /** Resolved API base (origin + /api/v1). Needed for full-page OAuth navigations. */
  getApiBaseUrl(): string;
  apiRequest<T>(path: string, opts?: RequestOptions): Promise<T>;
  apiStream(
    path: string,
    opts?: Omit<RequestOptions, "raw">,
  ): Promise<{ stream: AsyncGenerator<string>; response: Response }>;
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  const baseUrl = normalizeApiBaseUrl(config.baseUrl);
  const { store, onUnauthorized, onWorkspaceReset } = config;
  const doFetch = config.fetchImpl ?? globalThis.fetch;

  async function apiRequestInternal<T>(
    path: string,
    opts: RequestOptions,
    isRetry: boolean,
  ): Promise<T> {
    // baseUrl is always absolute on native and may be relative on web, so keep
    // a base for URL() to resolve against rather than assuming an origin.
    const url = new URL(`${baseUrl}${path}`, "http://localhost");
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }

    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    const token = store.getToken();
    if (token) headers.authorization = `Bearer ${token}`;
    const workspaceId = store.getWorkspaceId();
    if (workspaceId) headers["x-workspace-id"] = workspaceId;

    const response = await doFetch(url.toString(), {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });

    if (!response.ok) {
      // Read the error payload off a clone so a `raw` caller (apiStream) still
      // gets an unconsumed body to parse. This runs BEFORE the raw early-return
      // so streaming endpoints get the same self-heal and session-expiry
      // handling as everything else.
      let payload: { error?: string; message?: string; details?: unknown } = {};
      try {
        payload = await (opts.raw ? response.clone() : response).json();
      } catch {
        /* response not JSON */
      }

      // Self-heal a stale workspace id: if the middleware says we're not a
      // member of the workspace we asked about, our stored id is from a
      // previous session. Clear it and retry once — the next request omits the
      // header and the server falls back to the user's first workspace.
      if (
        !isRetry &&
        response.status === 403 &&
        workspaceId &&
        typeof payload.message === "string" &&
        /not a member of this workspace/i.test(payload.message)
      ) {
        store.setWorkspaceId(null);
        onWorkspaceReset?.();
        return apiRequestInternal<T>(path, opts, true);
      }

      // Token present but rejected — expired, revoked, or signed with a rotated
      // secret. Without this the app keeps a dead token forever: the auth guard
      // sees a non-empty string and mounts the shell, every query 401s, and
      // there is no route back to sign-in. /auth/* is exempt, since a 401 there
      // just means wrong credentials.
      if (response.status === 401 && !path.startsWith("/auth/")) {
        store.setToken(null);
        store.setWorkspaceId(null);
        onUnauthorized?.();
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

  return {
    getApiBaseUrl: () => baseUrl,

    apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
      return apiRequestInternal<T>(path, opts, false);
    },

    async apiStream(path: string, opts: Omit<RequestOptions, "raw"> = {}) {
      const response = (await apiRequestInternal<Response>(
        path,
        { ...opts, raw: true },
        false,
      )) as Response;

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

      // The endpoints are Hono stream() — plain chunked text/plain, not SSE.
      if (!response.body) {
        // The web client returned an empty generator here, which surfaces as
        // "the AI answered nothing" rather than an error. On React Native this
        // is the expected outcome of using the built-in fetch instead of
        // expo/fetch, so fail loudly with a diagnosable message.
        throw new ApiError(
          0,
          "stream_unsupported",
          "This fetch implementation does not expose a readable response body. " +
            "Pass fetch from 'expo/fetch' as fetchImpl on React Native.",
        );
      }

      const body = response.body;
      const stream = (async function* () {
        const reader = body.getReader();
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
    },
  };
}
