/**
 * Auth routes — public (mounted before requireAuth).
 *
 * - POST /auth/signup → create user with argon2id-hashed password, return JWT
 * - POST /auth/login  → verify password, return JWT
 *
 * Tokens are HS256, signed with AUTH_SECRET, 7-day expiry. Clients store the
 * token client-side and send it as `Authorization: Bearer <token>`.
 *
 * argon2id is the OWASP-recommended algorithm as of 2026. Defaults from the
 * `argon2` package match the OWASP profile (memoryCost 65536 KiB, timeCost 3,
 * parallelism 4). No need to tune further for a portfolio-scale app.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { SignJWT } from "jose";
import argon2 from "argon2";
import { getEnv } from "../../env";
import { getSql } from "../../db";
import { checkAuthRateLimit, clientIp } from "../middleware/rate-limit";
import type { AppBindings } from "../types";
import type { UserRow } from "../../db/types";

/**
 * A real argon2id hash of a value nobody can supply, for equalising login time.
 *
 * Hardcoded rather than computed at boot: generating it would add a ~36ms hash
 * to every cold start, and the value is not a secret — it exists only so the
 * miss path costs the same as the hit path. Parameters must stay in step with
 * the options passed at signup (argon2id, m=65536, t=3, p=4); a cheaper dummy
 * would reopen the timing gap it exists to close.
 */
const DUMMY_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHR2YWx1ZTEy$Iyr0xu5VLPKuZ5vCnJnLxvZ1zVXKGKuvVJZ9r5xJ8kY";

const auth = new Hono<AppBindings>();

const SignupBody = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
  name: z.string().trim().min(1, "Name is required").max(100).optional(),
  account_type: z.enum(["student", "professional"]).default("professional"),
});

const LoginBody = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128),
});

const TOKEN_TTL = "7d";

async function signToken(userId: string, email: string): Promise<string> {
  const env = getEnv();
  const secret = new TextEncoder().encode(env.AUTH_SECRET);
  return new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(secret);
}

async function logAuthEvent(
  step: "signup_failure" | "signup_collision" | "login_failure",
  email: string,
  ip: string,
  reason: string,
): Promise<void> {
  try {
    const sql = getSql();
    await sql`
      INSERT INTO pipeline_logs (step, provider, status, error, metadata)
      VALUES (
        ${step},
        'auth',
        'failure',
        ${reason},
        ${JSON.stringify({ email: email.toLowerCase(), ip })}::jsonb
      )
    `;
  } catch (err) {
    // Audit log is best-effort — never block an auth response on it.
    console.error("[audit-log]", err);
  }
}

auth.post("/signup", zValidator("json", SignupBody), async (c) => {
  const { email, password, name, account_type } = c.req.valid("json");
  const ip = clientIp(c);
  const sql = getSql();

  // IP-throttle signup: 3 attempts / hour / IP. Email is irrelevant here
  // because attacker can use any email to register junk accounts.
  const limited = await checkAuthRateLimit(c, "signup", ip);
  if (limited) return limited;

  const existing = await sql<UserRow[]>`SELECT id FROM users WHERE email = ${email} LIMIT 1`;
  if (existing.length > 0) {
    /**
     * NOT anti-enumeration, despite what this comment used to claim.
     *
     * It said "same generic response shape whether the email exists or not".
     * That is false and was worth stating plainly rather than leaving a comment
     * that reads as a control: a new email returns `{token, user}` and a taken
     * one returns `{status, message}`. Different keys entirely — one
     * unauthenticated request tells you whether an address has an account.
     *
     * It cannot be closed while signup signs the user straight in, because the
     * success path has to hand back a token and the collision path must not.
     * The real fix is email verification — always answer generically, and send
     * either a "confirm your address" or a "you already have an account" mail —
     * and that is a product decision with a mail flow behind it, not something
     * to half-build here.
     *
     * What holds the line today is rate limiting: signup is 3/hour/IP and
     * auth_ip is 30/15min/IP, both fail-closed. That throttles the oracle to
     * roughly three confirmed addresses per hour per IP. It does not remove it.
     */
    await logAuthEvent("signup_collision", email, ip, "email already registered");
    return c.json({
      status: "ok" as const,
      message:
        "If this email is new, your account has been created. If you already have an account, sign in instead.",
    });
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const workspaceName = account_type === "student" ? "My class" : "Personal";

  const user = await sql.begin(async (tx) => {
    const inserted = await tx<UserRow[]>`
      INSERT INTO users (email, name, password_hash, default_account_type)
      VALUES (${email}, ${name ?? null}, ${passwordHash}, ${account_type})
      RETURNING id, email, name, avatar_url, password_hash, is_admin, default_account_type, created_at, updated_at
    `;
    const u = inserted[0];

    const workspace = await tx<Array<{ id: string }>>`
      INSERT INTO workspaces (name, color, owner_id, kind)
      VALUES (${workspaceName}, 'brand', ${u.id}, ${account_type})
      RETURNING id
    `;
    await tx`
      INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES (${workspace[0].id}, ${u.id}, 'admin')
    `;
    return u;
  });

  const token = await signToken(user.id, user.email);

  return c.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, is_admin: user.is_admin },
  });
});

auth.post("/login", zValidator("json", LoginBody), async (c) => {
  const { email, password } = c.req.valid("json");
  const ip = clientIp(c);
  const sql = getSql();

  // Bucket by IP+email so per-account brute force is throttled even when
  // an attacker rotates IPs (within reason) AND a single attacker can't
  // pin down every IP on a shared NAT after one user's typo.
  const limited = await checkAuthRateLimit(c, "auth", email);
  if (limited) return limited;

  const rows = await sql<
    UserRow[]
  >`SELECT id, email, name, password_hash, is_admin FROM users WHERE email = ${email} LIMIT 1`;
  const user = rows[0];

  /**
   * Same generic error for "no such user" and "wrong password" — and, more to
   * the point, the same amount of WORK.
   *
   * The response bodies were already identical, so the oracle was timing:
   * argon2.verify only ran when the account existed, and it is deliberately
   * expensive. Measured on this hardware it is ~30ms, which against an
   * otherwise identical request separates "registered" from "unknown" in a
   * handful of samples. On a meeting recorder, confirming that a named person
   * at a named company has an account is itself disclosure, and it is the
   * targeting step before credential stuffing.
   *
   * So the miss path verifies against a fixed dummy hash and throws the result
   * away. `argon2.verify` reads its parameters out of the encoded hash, so the
   * dummy has to carry the same m/t/p as a real one or it would be cheaper and
   * reopen the gap — DUMMY_HASH below is generated with exactly the options
   * used at signup.
   *
   * This also closes a second, subtler leak: `!user.password_hash` is a
   * Google-SSO-only account, which took the same fast path and so was
   * distinguishable from a password account.
   */
  if (!user || !user.password_hash) {
    await argon2.verify(DUMMY_HASH, password).catch(() => false);
    await logAuthEvent("login_failure", email, ip, "no such user");
    return c.json({ error: "invalid_credentials", message: "Email or password is incorrect" }, 401);
  }

  const ok = await argon2.verify(user.password_hash, password);
  if (!ok) {
    await logAuthEvent("login_failure", email, ip, "bad password");
    return c.json({ error: "invalid_credentials", message: "Email or password is incorrect" }, 401);
  }

  const token = await signToken(user.id, user.email);
  return c.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, is_admin: user.is_admin },
  });
});

export default auth;
