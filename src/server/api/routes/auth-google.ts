/**
 * Google SSO — public routes, mounted under /auth (before requireAuth).
 *
 * - GET /auth/google           → redirect to Google's consent screen
 * - GET /auth/google/callback  → exchange code, verify ID token, issue our JWT
 *
 * Flow notes:
 *
 * CSRF is handled with a signed, 10-minute `state` JWT rather than a
 * server-side session. The API is horizontally scaled on Railway and has no
 * sticky sessions, so a Redis round-trip would be the only stateful
 * alternative — signing with AUTH_SECRET gets the same guarantee for free.
 *
 * We verify Google's ID token against their published JWKS rather than
 * trusting the token endpoint response blindly. The token came over TLS from
 * Google directly, so this is belt-and-braces, but it also pins the `aud` to
 * our client ID — which is what stops a token minted for a *different* app
 * from being replayed here.
 *
 * The resulting Puffin JWT is handed to the browser in the URL *fragment*,
 * not the query string. Fragments are never sent to the server, so the token
 * stays out of access logs, Referer headers, and Railway's HTTP logs.
 */

import { Hono } from "hono";
import { SignJWT, jwtVerify, createRemoteJWKSet } from "jose";
import { getEnv } from "../../env";
import { getSql } from "../../db";
import type { AppBindings } from "../types";
import type { UserRow } from "../../db/types";

const googleAuth = new Hono<AppBindings>();

const TOKEN_TTL = "7d";
const STATE_TTL = "10m";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

/**
 * Google's public signing keys. createRemoteJWKSet caches the key set and
 * refreshes it on unknown-kid, so this is safe to hold at module scope and
 * costs one fetch per key rotation rather than one per sign-in.
 */
const googleJwks = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

interface GoogleTokenResponse {
  id_token?: string;
  error?: string;
  error_description?: string;
}

/**
 * The public origin of *this* API, as the browser reached it.
 *
 * Google requires the redirect_uri on the callback to byte-match the one sent
 * on the authorize request, and both must be registered in the Google Cloud
 * console. Deriving it from the request (honouring Railway's proxy headers)
 * keeps local dev and production working without a second env var to forget.
 */
function apiOrigin(reqUrl: string, headers: Headers): string {
  const url = new URL(reqUrl);
  const proto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = headers.get("x-forwarded-host")?.split(",")[0]?.trim() ?? headers.get("host");
  if (host) return `${proto ?? url.protocol.replace(":", "")}://${host}`;
  return url.origin;
}

function redirectUriFor(reqUrl: string, headers: Headers): string {
  return `${apiOrigin(reqUrl, headers)}/api/v1/auth/google/callback`;
}

/**
 * Where a native client may be sent when the round trip finishes.
 *
 * An exact-match allowlist, and it has to stay one. This value ends up in a
 * `Response.redirect` carrying a freshly minted session JWT in the fragment, so
 * anything reachable here is a credential-stealing open redirect. A prefix or
 * origin check is not sufficient — `echobrief://auth/callback.evil` passes a
 * `startsWith` — and the set of legitimate destinations is exactly one string,
 * so it is compared as one.
 *
 * `echobrief` is the scheme declared in apps/mobile/app.json; the client builds
 * the same URL from that manifest rather than hardcoding it, so the two agree
 * by construction and a scheme rename breaks loudly at sign-in rather than
 * silently redirecting somewhere unclaimed.
 *
 * The web app is NOT in this list: it does not send `redirect_uri` at all and
 * keeps falling through to APP_URL, exactly as before.
 */
const NATIVE_RETURN_URIS: readonly string[] = ["echobrief://auth/callback"];

/**
 * Resolve the caller's requested return target, or null for the web default.
 *
 * Called only when ISSUING the state, never when consuming it — the resolved
 * value is then carried inside the signed state, so the callback trusts a
 * string it signed itself rather than one arriving on the query string.
 */
function nativeReturnUri(requested: string | undefined): string | null {
  if (!requested) return null;
  return NATIVE_RETURN_URIS.includes(requested) ? requested : null;
}

/**
 * Send the browser back to the caller's callback with an error code.
 *
 * `returnTo` is either the web app's page or an allowlisted native URL that was
 * validated when the state was signed. A native caller has to receive its
 * failures on its own scheme too: an error delivered to the https page is a
 * dead end that leaves ASWebAuthenticationSession hanging until the user
 * cancels, which reads as the app freezing rather than as sign-in failing.
 */
function failTo(returnTo: string, code: string): Response {
  const separator = returnTo.startsWith("echobrief://") ? "" : "/auth/callback";
  return Response.redirect(`${returnTo}${separator}#error=${encodeURIComponent(code)}`, 302);
}

googleAuth.get("/google", async (c) => {
  const env = getEnv();

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return c.json(
      {
        error: "google_sso_unconfigured",
        message: "Google sign-in is not configured on this server.",
      },
      503,
    );
  }

  const secret = new TextEncoder().encode(env.AUTH_SECRET);
  // Carry the signup account type through the round-trip so a student who
  // clicks "Sign up with Google" still lands in a student workspace. It rides
  // inside the signed state, so the user can't tamper with it mid-flight.
  const requested = c.req.query("account_type");
  const accountType = requested === "student" ? "student" : "professional";

  // A random nonce makes each state single-use in practice: it is echoed back
  // in the ID token and compared below.
  const nonce = crypto.randomUUID();
  // Allowlisted HERE, at issue time, and then carried inside the signature. The
  // callback never reads a redirect target off the query string, so tampering
  // mid-flight would have to forge a JWT signed with AUTH_SECRET.
  const returnTo = nativeReturnUri(c.req.query("redirect_uri"));
  const state = await new SignJWT({
    nonce,
    purpose: "google_oauth",
    account_type: accountType,
    ...(returnTo ? { return_to: returnTo } : {}),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(STATE_TTL)
    .sign(secret);

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUriFor(c.req.url, c.req.raw.headers),
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    // Force the account chooser so a signed-in-to-Google user can still pick
    // which account to use rather than being silently logged into the first.
    prompt: "select_account",
  });

  return c.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
});

/**
 * Best-effort read of the return target out of an unconsumed state.
 *
 * Separate from the main verification below, which also establishes the nonce
 * and account type and must reject anything invalid. This one only answers
 * "where should the answer be delivered", and any doubt resolves to the web
 * app — a failure to verify here must never widen the set of destinations.
 */
async function resolveReturnTarget(
  state: string | undefined,
  authSecret: string,
  appUrl: string,
): Promise<string> {
  if (!state) return appUrl;
  try {
    const secret = new TextEncoder().encode(authSecret);
    const { payload } = await jwtVerify(state, secret, { algorithms: ["HS256"] });
    if (payload.purpose !== "google_oauth" || typeof payload.return_to !== "string") return appUrl;
    return nativeReturnUri(payload.return_to) ?? appUrl;
  } catch {
    return appUrl;
  }
}

googleAuth.get("/google/callback", async (c) => {
  const env = getEnv();
  const appUrl = env.APP_URL;

  const code = c.req.query("code");
  const state = c.req.query("state");
  const oauthError = c.req.query("error");

  /**
   * Resolve the caller BEFORE handling failures.
   *
   * Cancelling on the consent screen is the single most common way this route
   * ends, and Google returns our `state` with it. Without reading that here, a
   * native cancel would 302 to the web app's https page — which
   * ASWebAuthenticationSession cannot intercept, so the sheet would sit there
   * until the user cancelled a second time. Two cancels to cancel reads as the
   * app being broken.
   *
   * Verified, not parsed: this goes through the same signature check as the
   * main path, and falls back to the web app on anything it cannot verify.
   */
  const returnTarget = await resolveReturnTarget(state, env.AUTH_SECRET, appUrl);

  // Config check after the target is known, so a misconfigured server still
  // answers a native caller on its own scheme instead of stranding the auth
  // sheet on a page it cannot read.
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return failTo(returnTarget, "google_sso_unconfigured");
  }

  // User pressed "Cancel" on the consent screen, or Google rejected the app.
  if (oauthError) return failTo(returnTarget, oauthError);
  if (!code || !state) return failTo(returnTarget, "missing_code");

  // --- CSRF: the state must be one we signed, and not yet expired ----------
  let nonce: string;
  let accountType: "student" | "professional";
  /**
   * Where this particular sign-in came from.
   *
   * Starts as the web app and is only replaced by a value read OUT OF THE
   * VERIFIED STATE below — never off the query string. Declared before the try
   * so a state that fails verification still fails to the web page rather than
   * to a target an attacker chose.
   */
  let returnTo = returnTarget;
  try {
    const secret = new TextEncoder().encode(env.AUTH_SECRET);
    const { payload } = await jwtVerify(state, secret, { algorithms: ["HS256"] });
    if (payload.purpose !== "google_oauth" || typeof payload.nonce !== "string") {
      return failTo(returnTo, "invalid_state");
    }
    nonce = payload.nonce;
    accountType = payload.account_type === "student" ? "student" : "professional";
    // Re-checked against the allowlist even though we signed it: a target that
    // was valid when the state was minted must still be valid now, and this
    // costs one array lookup to make the allowlist the single source of truth.
    if (typeof payload.return_to === "string") {
      returnTo = nativeReturnUri(payload.return_to) ?? appUrl;
    }
  } catch {
    return failTo(returnTo, "invalid_state");
  }

  // --- Exchange the authorization code for an ID token --------------------
  let idToken: string;
  try {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUriFor(c.req.url, c.req.raw.headers),
        grant_type: "authorization_code",
      }),
    });
    const body = (await res.json()) as GoogleTokenResponse;
    if (!res.ok || !body.id_token) {
      console.error("[google-sso] token exchange failed", body.error, body.error_description);
      return failTo(returnTo, "token_exchange_failed");
    }
    idToken = body.id_token;
  } catch (err) {
    console.error("[google-sso] token exchange error", err);
    return failTo(returnTo, "token_exchange_failed");
  }

  // --- Verify the ID token and pull the identity out ----------------------
  let googleId: string;
  let email: string;
  let name: string | null;
  let avatarUrl: string | null;
  try {
    const { payload } = await jwtVerify(idToken, googleJwks, {
      audience: env.GOOGLE_CLIENT_ID,
      issuer: GOOGLE_ISSUERS,
    });

    if (payload.nonce !== nonce) return failTo(returnTo, "invalid_nonce");

    // email_verified is the linchpin of the account-linking rule below. Without
    // it, anyone able to set an arbitrary unverified email at an IdP could take
    // over an existing Puffin account by signing in with a matching address.
    if (payload.email_verified !== true) return failTo(returnTo, "email_unverified");

    if (typeof payload.sub !== "string" || typeof payload.email !== "string") {
      return failTo(returnTo, "invalid_id_token");
    }

    googleId = payload.sub;
    email = payload.email.trim().toLowerCase();
    name = typeof payload.name === "string" ? payload.name : null;
    avatarUrl = typeof payload.picture === "string" ? payload.picture : null;
  } catch (err) {
    console.error("[google-sso] id_token verification failed", err);
    return failTo(returnTo, "invalid_id_token");
  }

  // --- Resolve to an Puffin user ---------------------------------------
  const sql = getSql();
  let user: UserRow | undefined;

  try {
    const byGoogle = await sql<UserRow[]>`
      SELECT id, email, name, avatar_url, password_hash, is_admin, default_account_type,
             created_at, updated_at
      FROM users WHERE google_id = ${googleId} LIMIT 1
    `;
    user = byGoogle[0];

    if (!user) {
      // Link an existing password account with the same verified address.
      const byEmail = await sql<UserRow[]>`
        SELECT id, email, name, avatar_url, password_hash, is_admin, default_account_type,
               created_at, updated_at
        FROM users WHERE email = ${email} LIMIT 1
      `;
      if (byEmail[0]) {
        const linked = await sql<UserRow[]>`
          UPDATE users
          SET google_id  = ${googleId},
              avatar_url = COALESCE(avatar_url, ${avatarUrl}),
              name       = COALESCE(name, ${name}),
              updated_at = now()
          WHERE id = ${byEmail[0].id}
          RETURNING id, email, name, avatar_url, password_hash, is_admin, default_account_type,
                    created_at, updated_at
        `;
        user = linked[0];
      }
    }

    if (!user) {
      // Brand new user. Mirrors POST /auth/signup: create the user plus their
      // first workspace and membership in one transaction, so we never end up
      // with a user who has nowhere to put a meeting.
      const workspaceName = accountType === "student" ? "My class" : "Personal";
      user = await sql.begin(async (tx) => {
        const inserted = await tx<UserRow[]>`
          INSERT INTO users (email, name, avatar_url, google_id, default_account_type)
          VALUES (${email}, ${name}, ${avatarUrl}, ${googleId}, ${accountType})
          RETURNING id, email, name, avatar_url, password_hash, is_admin, default_account_type,
                    created_at, updated_at
        `;
        const u = inserted[0];

        const workspace = await tx<Array<{ id: string }>>`
          INSERT INTO workspaces (name, color, owner_id, kind)
          VALUES (${workspaceName}, 'brand', ${u.id}, ${accountType})
          RETURNING id
        `;
        await tx`
          INSERT INTO workspace_members (workspace_id, user_id, role)
          VALUES (${workspace[0].id}, ${u.id}, 'admin')
        `;
        return u;
      });
    }
  } catch (err) {
    console.error("[google-sso] user resolution failed", err);
    return failTo(returnTo, "server_error");
  }

  // --- Issue our own JWT, exactly as password login does ------------------
  const secret = new TextEncoder().encode(env.AUTH_SECRET);
  const token = await new SignJWT({ email: user.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(secret);

  // Fragment, not query — see the file header.
  // Fragment, not query: fragments are never sent to a server, so the session
  // token stays out of access logs and Referer headers. On the native path this
  // is `echobrief://auth/callback#token=…`, which ASWebAuthenticationSession
  // hands straight back to the app.
  const separator = returnTo.startsWith("echobrief://") ? "" : "/auth/callback";
  return c.redirect(`${returnTo}${separator}#token=${encodeURIComponent(token)}`);
});

export default googleAuth;
