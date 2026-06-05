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
    // Anti-enumeration: same generic response shape whether the email exists
    // or not. We log the collision server-side; a separate "this email is
    // already registered, did you mean to sign in?" email could be sent.
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

  // Use the same generic error for "no such user" and "wrong password" so
  // we don't leak which emails are registered.
  if (!user || !user.password_hash) {
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
