import { Redirect } from "expo-router";

import { tokenStore } from "@/lib/api/token-store";

/**
 * Entry gate.
 *
 * The root layout holds the splash until hydrateSession() resolves, so by the
 * time this renders the in-memory token cache reflects the Keychain. A token
 * here is not proof of a valid session — it may be expired or revoked — but the
 * first API call will 401 and the session listener routes back to sign-in.
 */
export default function Index() {
  return <Redirect href={tokenStore.getToken() ? "/(app)" : "/(auth)/sign-in"} />;
}
