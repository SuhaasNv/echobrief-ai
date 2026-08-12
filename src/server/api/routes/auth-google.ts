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
 * The resulting EchoBrief JWT is handed to the browser in the URL *fragment*,
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

/** Send the browser back to the frontend's callback page with an error code. */
function failTo(appUrl: string, code: string): Response {
  return Response.redirect(`${appUrl}/auth/callback#error=${encodeURIComponent(code)}`, 302);
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
  const state = await new SignJWT({ nonce, purpose: "google_oauth", account_type: accountType })
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

googleAuth.get("/google/callback", async (c) => {
  const env = getEnv();
  const appUrl = env.APP_URL;

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return failTo(appUrl, "google_sso_unconfigured");
  }

  const code = c.req.query("code");
  const state = c.req.query("state");
  const oauthError = c.req.query("error");

  // User pressed "Cancel" on the consent screen, or Google rejected the app.
  if (oauthError) return failTo(appUrl, oauthError);
  if (!code || !state) return failTo(appUrl, "missing_code");

  // --- CSRF: the state must be one we signed, and not yet expired ----------
  let nonce: string;
  let accountType: "student" | "professional";
  try {
    const secret = new TextEncoder().encode(env.AUTH_SECRET);
    const { payload } = await jwtVerify(state, secret, { algorithms: ["HS256"] });
    if (payload.purpose !== "google_oauth" || typeof payload.nonce !== "string") {
      return failTo(appUrl, "invalid_state");
    }
    nonce = payload.nonce;
    accountType = payload.account_type === "student" ? "student" : "professional";
  } catch {
    return failTo(appUrl, "invalid_state");
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
      return failTo(appUrl, "token_exchange_failed");
    }
    idToken = body.id_token;
  } catch (err) {
    console.error("[google-sso] token exchange error", err);
    return failTo(appUrl, "token_exchange_failed");
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

    if (payload.nonce !== nonce) return failTo(appUrl, "invalid_nonce");

    // email_verified is the linchpin of the account-linking rule below. Without
    // it, anyone able to set an arbitrary unverified email at an IdP could take
    // over an existing EchoBrief account by signing in with a matching address.
    if (payload.email_verified !== true) return failTo(appUrl, "email_unverified");

    if (typeof payload.sub !== "string" || typeof payload.email !== "string") {
      return failTo(appUrl, "invalid_id_token");
    }

    googleId = payload.sub;
    email = payload.email.trim().toLowerCase();
    name = typeof payload.name === "string" ? payload.name : null;
    avatarUrl = typeof payload.picture === "string" ? payload.picture : null;
  } catch (err) {
    console.error("[google-sso] id_token verification failed", err);
    return failTo(appUrl, "invalid_id_token");
  }

  // --- Resolve to an EchoBrief user ---------------------------------------
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
    return failTo(appUrl, "server_error");
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
  return c.redirect(`${appUrl}/auth/callback#token=${encodeURIComponent(token)}`);
});

export default googleAuth;
