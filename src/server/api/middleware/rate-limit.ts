/**
 * Redis-backed sliding-window rate limiter.
 *
 * Keys: ratelimit:{user_id|ip}:{bucket}:{window}
 * Two buckets:
 *   - general — 100 req/min/user
 *   - ai      — 10 req/min/user (LLM-heavy endpoints)
 */

import type { MiddlewareHandler } from "hono";
import { getRedis } from "../../services/redis";
import type { AppBindings } from "../types";

interface Limits {
  general: { max: number; window_sec: number };
  ai: { max: number; window_sec: number };
}

const LIMITS: Limits = {
  general: { max: 100, window_sec: 60 },
  ai: { max: 10, window_sec: 60 },
};

export function rateLimit(bucket: keyof Limits): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const { max, window_sec } = LIMITS[bucket];
    const user = c.get("user");
    const identifier =
      user?.id ?? c.req.header("x-forwarded-for") ?? c.req.header("cf-connecting-ip") ?? "anonymous";

    const windowStart = Math.floor(Date.now() / 1000 / window_sec);
    const key = `ratelimit:${identifier}:${bucket}:${windowStart}`;

    const redis = getRedis();
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, window_sec * 2);
    }

    if (count > max) {
      return c.json(
        {
          error: "rate_limited",
          message: `Too many requests. Limit: ${max} per ${window_sec}s.`,
        },
        429,
        { "Retry-After": String(window_sec) },
      );
    }

    await next();
  };
}
