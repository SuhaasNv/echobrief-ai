import { fetch as expoFetch } from "expo/fetch";
import { createApiClient } from "@echobrief/shared/api";

import { tokenStore } from "./token-store";
import { emitSessionEvent } from "./session-events";

/**
 * EXPO_PUBLIC_* variables are inlined by Metro at build time, so this must be a
 * static `process.env.X` member expression. Destructuring or bracket access
 * (`process.env["..."]`) is NOT inlined and silently yields undefined.
 */
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";

export const api = createApiClient({
  baseUrl: API_URL,
  store: tokenStore,
  // React Native's built-in fetch is an XHR polyfill with no `response.body`,
  // which would break chat, search, and email generation. expo/fetch is a real
  // WHATWG implementation with ReadableStream support. Imported by name rather
  // than relying on the global so this survives anyone opting back into the RN
  // implementation.
  fetchImpl: expoFetch as unknown as typeof globalThis.fetch,
  onUnauthorized: () => emitSessionEvent("unauthorized"),
  onWorkspaceReset: () => emitSessionEvent("workspace-reset"),
});

export const { apiRequest, apiStream, getApiBaseUrl } = api;
