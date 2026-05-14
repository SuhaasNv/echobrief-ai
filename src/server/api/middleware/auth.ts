/**
 * JWT auth middleware.
 *
 * Verifies a bearer JWT signed with BETTER_AUTH_SECRET. Better Auth is wired
 * in src/server/auth (see TODO). For now this verifies any HS256 JWT with the
 * shared secret — the user object's `id` is the only field we depend on.
 */

import type { MiddlewareHandler } from "hono";
import { jwtVerify } from "jose";
import { getEnv } from "../../env";
import type { AppBindings } from "../types";

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
  const secret = new TextEncoder().encode(env.BETTER_AUTH_SECRET);

  try {
    const { payload } = await jwtVerify(jwt, secret, {
      // Accept HS256 by default; tighten if Better Auth rotates algorithms.
      algorithms: ["HS256"],
    });

    if (typeof payload.sub !== "string") {
      return c.json({ error: "unauthorized", message: "Token missing subject" }, 401);
    }

    c.set("user", {
      id: payload.sub,
      email: typeof payload.email === "string" ? payload.email : "",
      jwt,
    });

    await next();
  } catch (err) {
    return c.json(
      {
        error: "unauthorized",
        message: err instanceof Error ? err.message : "Invalid token",
      },
      401,
    );
  }
};
