import { useMutation, useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import * as WebBrowser from "expo-web-browser";

import { adoptSession } from "./auth";
import { api } from "./client";

/**
 * Sign in with Google.
 *
 * WHAT THE SERVER ACTUALLY IMPLEMENTS
 *
 * src/server/api/routes/auth-google.ts is a browser *redirect* flow, not a
 * native token exchange. There is no endpoint that accepts a Google ID token or
 * an authorization code, so this app never talks to Google directly. It opens
 * the API's own GET /auth/google, which 302s to Google's consent screen using
 * the API's web client id and the API's own /auth/google/callback as
 * redirect_uri. The API then does the code exchange with its client *secret*,
 * verifies the returned ID token against Google's JWKS (pinning `aud` to its
 * client id), links or creates the user, and signs the same 7-day EchoBrief JWT
 * that POST /auth/login signs.
 *
 * Two consequences worth stating outright:
 *
 *   No Google client id or secret ever reaches this app. Both halves live on
 *   the server, and the public half only ever appears inside a URL the server
 *   built. There is deliberately no EXPO_PUBLIC_GOOGLE_CLIENT_ID — adding one
 *   would imply a native flow that the server cannot service.
 *
 *   The resulting session is indistinguishable from a password login, so it
 *   goes through the same adoptSession(). Nothing downstream — the auth guard,
 *   the 401 listener, sign-out — needs a Google branch, and none was added.
 *
 * Account collisions are resolved server-side: a Google identity whose
 * *verified* email already has a password account is LINKED to that user rather
 * than rejected or duplicated. So there is no "this email is already
 * registered" case to handle here, unlike password signup.
 *
 * WHAT IS NOT WIRED YET  (see also: the report accompanying this change)
 *
 * The API's callback finishes with a redirect to `${APP_URL}/auth/callback#token=…`
 * — a fixed https URL pointing at the *web* app. iOS's ASWebAuthenticationSession
 * can only intercept a custom scheme, and the fragment of an https page is not
 * readable from here, so this flow cannot complete on device until the server
 * sends a native caller back to this app's scheme instead. `redirect_uri` is
 * already sent below for exactly that purpose; the server ignores unknown query
 * params today, so sending it is free and means the fix is server-side only.
 */

/**
 * Path on our own scheme that the API should redirect to when it is finished.
 *
 * ASWebAuthenticationSession hands this URL straight back to the caller rather
 * than routing it, so there is no expo-router screen behind it and none is
 * needed — the app never actually navigates here.
 */
const RETURN_PATH = "auth/callback";

/**
 * User-facing copy for the codes the API can hand back.
 *
 * Deliberately the same set and the same wording as ERROR_COPY in
 * src/routes/auth.callback.tsx. The web page and this map are two readers of
 * one server contract; if a code is added there it must be added here, and the
 * fallback below is what stops an unknown code rendering as nothing at all.
 */
const ERROR_COPY: Record<string, string> = {
  google_sso_unconfigured: "Google sign-in isn't configured on this server.",
  access_denied: "Sign-in cancelled.",
  missing_code: "Google didn't return an authorization code.",
  invalid_state: "Sign-in request expired or was tampered with. Please try again.",
  invalid_nonce: "Sign-in request could not be verified. Please try again.",
  email_unverified: "Your Google email address isn't verified.",
  invalid_id_token: "Google's response could not be verified.",
  token_exchange_failed: "Could not complete sign-in with Google.",
  server_error: "Something went wrong finishing sign-in.",
};

const GENERIC_FAILURE = "Couldn't finish signing in with Google. Please try again.";

/**
 * A failure the user should be told about, carrying copy that is already
 * user-facing.
 *
 * A distinct class rather than a bare Error so googleAuthErrorMessage can tell
 * "the flow failed, and here is why" apart from an unexpected throw, and show
 * the generic line for the latter instead of leaking an internal message.
 */
export class GoogleSignInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleSignInError";
  }
}

export type GoogleSignInOutcome =
  /** A session was adopted; the caller should navigate. */
  | { status: "signed-in" }
  /** The user backed out. Not an error — show nothing, just stop the spinner. */
  | { status: "cancelled" };

/**
 * Where the API should send the browser back to, built from the scheme declared
 * in app.json.
 *
 * Read from the manifest rather than written out here: the scheme is registered
 * in the iOS project at prebuild time from that one value, and a literal in this
 * file would be a second copy free to drift from the one the OS actually honours.
 */
function returnUrl(): string {
  const scheme = Constants.expoConfig?.scheme;
  const name = Array.isArray(scheme) ? scheme[0] : scheme;

  if (!name) {
    // Only reachable if app.json loses its `scheme`, which would also break
    // every other deep link into the app. Naming the cause beats an opaque
    // "invalid url" out of the browser module.
    throw new GoogleSignInError("This build has no URL scheme, so sign-in can't return to it.");
  }

  return `${name}://${RETURN_PATH}`;
}

/**
 * Pull the result out of the URL the auth session returned.
 *
 * The fragment is checked before the query because that is where the API puts
 * the token — fragments are never sent to a server, so it stays out of access
 * logs and Referer headers. The query is read as a fallback so that a server
 * that later answers a native caller with `?token=` still works here.
 */
function resultParams(url: string): URLSearchParams {
  const hash = url.indexOf("#");
  if (hash !== -1) return new URLSearchParams(url.slice(hash + 1));

  const query = url.indexOf("?");
  if (query !== -1) return new URLSearchParams(url.slice(query + 1));

  return new URLSearchParams();
}

/**
 * Run the consent round-trip and return the EchoBrief JWT.
 *
 * openAuthSessionAsync is ASWebAuthenticationSession on iOS: a system sheet, not
 * an embedded web view. That is not a preference — Google blocks OAuth in
 * embedded user agents outright (`disallowed_useragent`), so a WebView-based
 * implementation would be refused by the consent screen. It also means the sheet
 * shares Safari's cookie jar, so someone already signed in to Google gets an
 * account chooser rather than a password prompt.
 */
async function requestToken(): Promise<string | null> {
  const start = new URL(`${api.getApiBaseUrl()}/auth/google`);
  start.searchParams.set("redirect_uri", returnUrl());

  const result = await WebBrowser.openAuthSessionAsync(start.toString(), returnUrl());

  // 'cancel' is the sheet's own Cancel button; 'dismiss' is a swipe-down or a
  // programmatic close. Neither is a failure, and neither may leave a spinner
  // running — this is the single most common way out of an OAuth screen.
  if (result.type === "cancel" || result.type === "dismiss") return null;

  if (result.type !== "success") {
    // 'locked' means another auth session is already on screen. Anything else
    // is a result type this module has not been taught about; both are worth a
    // visible message rather than a silent no-op.
    throw new GoogleSignInError(
      result.type === "locked"
        ? "Another sign-in is already open. Close it and try again."
        : GENERIC_FAILURE,
    );
  }

  const params = resultParams(result.url);
  const error = params.get("error");
  if (error) {
    // access_denied is Google's code for "the user pressed Cancel on the
    // consent screen", which is a cancellation rather than a failure.
    if (error === "access_denied") return null;
    throw new GoogleSignInError(ERROR_COPY[error] ?? GENERIC_FAILURE);
  }

  const token = params.get("token");
  if (!token) throw new GoogleSignInError(GENERIC_FAILURE);

  return token;
}

/**
 * The mutation the auth screens drive.
 *
 * Mirrors useSignIn: adopt the session, then clear the cache, because nothing
 * cached should survive a session change.
 */
export function useGoogleSignIn() {
  const queryClient = useQueryClient();

  return useMutation<GoogleSignInOutcome, Error, void>({
    mutationFn: async () => {
      const token = await requestToken();
      if (!token) return { status: "cancelled" };

      await adoptSession(token);
      return { status: "signed-in" };
    },
    onSuccess: (outcome) => {
      if (outcome.status === "signed-in") queryClient.clear();
    },
  });
}

/**
 * User-facing copy for a Google sign-in failure.
 *
 * Anything that is not a GoogleSignInError got here by surprise — a network
 * failure opening the sheet, a malformed base URL — and its message is not
 * written for a user, so it is replaced rather than shown.
 */
export function googleAuthErrorMessage(error: unknown): string {
  return error instanceof GoogleSignInError ? error.message : GENERIC_FAILURE;
}
