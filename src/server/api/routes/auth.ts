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
import type { AppBindings } from "../types";
import type { UserRow } from "../../db/types";

const auth = new Hono<AppBindings>();

const SignupBody = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
  name: z.string().trim().min(1, "Name is required").max(100).optional(),
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

auth.post("/signup", zValidator("json", SignupBody), async (c) => {
  const { email, password, name } = c.req.valid("json");
  const sql = getSql();

  const existing = await sql<UserRow[]>`SELECT id FROM users WHERE email = ${email} LIMIT 1`;
  if (existing.length > 0) {
    return c.json({ error: "conflict", message: "Account already exists for this email" }, 409);
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  const inserted = await sql<UserRow[]>`
    INSERT INTO users (email, name, password_hash)
    VALUES (${email}, ${name ?? null}, ${passwordHash})
    RETURNING id, email, name, avatar_url, password_hash, is_admin, created_at, updated_at
  `;
  const user = inserted[0];
  const token = await signToken(user.id, user.email);

  return c.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, is_admin: user.is_admin },
  });
});

auth.post("/login", zValidator("json", LoginBody), async (c) => {
  const { email, password } = c.req.valid("json");
  const sql = getSql();

  const rows = await sql<UserRow[]>`SELECT id, email, name, password_hash, is_admin FROM users WHERE email = ${email} LIMIT 1`;
  const user = rows[0];

  // Use the same generic error for "no such user" and "wrong password" so
  // we don't leak which emails are registered.
  if (!user || !user.password_hash) {
    return c.json({ error: "invalid_credentials", message: "Email or password is incorrect" }, 401);
  }

  const ok = await argon2.verify(user.password_hash, password);
  if (!ok) {
    return c.json({ error: "invalid_credentials", message: "Email or password is incorrect" }, 401);
  }

  const token = await signToken(user.id, user.email);
  return c.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, is_admin: user.is_admin },
  });
});

export default auth;
