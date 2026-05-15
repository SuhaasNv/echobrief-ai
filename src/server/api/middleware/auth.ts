/**
 * Auth middleware (self-hosted JWT).
 *
 * Verifies a bearer JWT signed with AUTH_SECRET (HS256) by /auth/login or
 * /auth/signup. Loads the user row from Postgres on every request so the
 * downstream `c.var.user` always reflects current DB state (e.g. is_admin
 * flips take effect immediately, no token-refresh dance).
 */

import type { MiddlewareHandler } from "hono";
import { jwtVerify } from "jose";
import { getEnv } from "../../env";
import { getSql } from "../../db";
import type { AppBindings } from "../types";
import type { UserRow } from "../../db/types";

export const requireAuth: MiddlewareHandler<AppBindings> = async (c, next) => {
  const authHeader = c.req.header("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "unauthorized", message: "Missing bearer token" }, 401);
  }

  const jwt = authHeader.slice("Bearer ".length).trim();
  if (!jwt) {
    return c.json({ error: "unauthorized", message: "Empty bearer token" }, 401);
  }

  const env = getEnv();
  const secret = new TextEncoder().encode(env.AUTH_SECRET);

  let userId: string;
  try {
    const { payload } = await jwtVerify(jwt, secret, { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string") {
      return c.json({ error: "unauthorized", message: "Token missing subject" }, 401);
    }
    userId = payload.sub;
  } catch (err) {
    return c.json(
      {
        error: "unauthorized",
        message: err instanceof Error ? err.message : "Invalid token",
      },
      401,
    );
  }

  const sql = getSql();
  const rows = await sql<UserRow[]>`
    SELECT id, email, name, avatar_url, password_hash, is_admin, created_at, updated_at
    FROM users WHERE id = ${userId} LIMIT 1
  `;
  const user = rows[0];
  if (!user) {
    return c.json({ error: "unauthorized", message: "User no longer exists" }, 401);
  }

  c.set("user", {
    id: user.id,
    email: user.email,
    is_admin: user.is_admin,
    jwt,
  });

  await next();
};

/**
 * Require an admin user. Mount AFTER requireAuth.
 */
export const requireAdmin: MiddlewareHandler<AppBindings> = async (c, next) => {
  const user = c.get("user");
  if (!user || !user.is_admin) {
    return c.json({ error: "forbidden", message: "Admin access required" }, 403);
  }
  await next();
};
