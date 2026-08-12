/**
 * Deliberately NOT re-exported from the package root.
 *
 * src/lib/schemas.ts does `export * from "@echobrief/shared"`, so anything on
 * the root index leaks into the web app's schemas module — and `ApiError` would
 * collide with the one the web client already exports.
 */

export {
  API_PATH_PREFIX,
  ApiError,
  createApiClient,
  normalizeApiBaseUrl,
} from "./client";

export type { ApiClient, ApiClientConfig, RequestOptions, TokenStore } from "./client";
