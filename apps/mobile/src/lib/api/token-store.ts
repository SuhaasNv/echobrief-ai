import * as SecureStore from "expo-secure-store";
import type { TokenStore } from "@echobrief/shared/api";

/**
 * Keychain-backed TokenStore with a synchronous in-memory cache.
 *
 * The shared client reads the token on every request via a synchronous
 * getToken(). Keychain access is async, so we hydrate once during splash and
 * write through on change. Making the read async would force every call site in
 * hooks.ts to become async and would defeat sharing that file at all.
 */

const TOKEN_KEY = "echobrief-auth-token";
const WORKSPACE_KEY = "echobrief-active-workspace";

const KEYCHAIN_OPTIONS: SecureStore.SecureStoreOptions = {
  // The default (WHEN_UNLOCKED) makes the token unreadable while the phone is
  // locked, which would break background uploads of a finished recording — the
  // single most likely moment for the screen to be off.
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

let cachedToken: string | null = null;
let cachedWorkspaceId: string | null = null;
let hydrated = false;

/** Fire-and-forget write. A failed Keychain write must not reject a request. */
function persist(key: string, value: string | null): void {
  const op =
    value === null
      ? SecureStore.deleteItemAsync(key, KEYCHAIN_OPTIONS)
      : SecureStore.setItemAsync(key, value, KEYCHAIN_OPTIONS);

  op.catch(() => {
    // Losing the write means the user re-authenticates next launch, which is
    // recoverable. Failing the in-flight request would not be.
  });
}

/**
 * Load persisted session into memory. Must complete before the first API call
 * and before the auth guard reads the token, or a signed-in user is briefly
 * treated as signed out and bounced to the sign-in screen.
 */
export async function hydrateSession(): Promise<void> {
  if (hydrated) return;

  const [token, workspaceId] = await Promise.all([
    SecureStore.getItemAsync(TOKEN_KEY, KEYCHAIN_OPTIONS).catch(() => null),
    SecureStore.getItemAsync(WORKSPACE_KEY, KEYCHAIN_OPTIONS).catch(() => null),
  ]);

  cachedToken = token;
  cachedWorkspaceId = workspaceId;
  hydrated = true;
}

export function isSessionHydrated(): boolean {
  return hydrated;
}

export const tokenStore: TokenStore = {
  getToken: () => cachedToken,
  setToken: (token) => {
    cachedToken = token;
    persist(TOKEN_KEY, token);
  },
  getWorkspaceId: () => cachedWorkspaceId,
  setWorkspaceId: (id) => {
    cachedWorkspaceId = id;
    persist(WORKSPACE_KEY, id);
  },
};

/**
 * Clear the session on sign-out.
 *
 * iOS Keychain entries survive app uninstall, so an explicit clear is the only
 * thing that actually ends a session — a reinstall alone would restore it.
 */
export function clearSession(): void {
  tokenStore.setToken(null);
  tokenStore.setWorkspaceId(null);
}
