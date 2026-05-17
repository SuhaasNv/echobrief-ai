/**
 * Redis-backed sliding-window rate limiter.
 *
 * Keys: ratelimit:{user_id|ip}:{bucket}:{window}
 *
 * Buckets:
 *   - general — 100 req/min/user — standard API endpoints (read/write)
 *   - ai      — 10 req/min/user  — LLM-heavy endpoints (cost protection)
 *   - auth    — 5 attempts / 15min / (IP + email) — login bruteforce defense
 *   - signup  — 3 signups / hour / IP — signup spam defense
 *
 * The auth bucket also accepts an explicit `keySuffix` so the caller can mix
 * email into the identifier (so per-account brute-force is throttled even
 * if attacker rotates IPs).
 */

import type { MiddlewareHandler, Context } from "hono";
import { getRedis } from "../../services/redis";
import type { AppBindings } from "../types";
import type { IncomingMessage } from "node:http";

interface BucketConfig {
  max: number;
  window_sec: number;
}

const LIMITS: Record<string, BucketConfig> = {
  general: { max: 100, window_sec: 60 },
  ai: { max: 10, window_sec: 60 },
  auth: { max: 5, window_sec: 60 * 15 },
  signup: { max: 3, window_sec: 60 * 60 },
};

/**
 * Best-effort client IP. Order:
 *   1. cf-connecting-ip (Cloudflare proxy header)
 *   2. x-forwarded-for first hop (when behind a trusted proxy like Railway)
 *   3. socket.remoteAddress (direct connection)
 *   4. "unknown" — falls into a shared bucket. Should be rare in practice.
 *
 * Hono's node adapter exposes the raw IncomingMessage via env.incoming.
 */
export function clientIp<E extends { Variables: AppBindings["Variables"] }>(
  c: Context<E>,
): string {
  const cf = c.req.header("cf-connecting-ip");
  if (cf) return cf.trim();

  const xff = c.req.header("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }

  // Node adapter — pull socket IP from the underlying IncomingMessage.
  const env = c.env as { incoming?: IncomingMessage } | undefined;
  const remote = env?.incoming?.socket?.remoteAddress;
  if (remote) return remote;

  return "unknown";
}

interface RateLimitOptions {
  /** Optional value mixed into the bucket key (e.g. email for login). */
  keySuffix?: string;
}

export function rateLimit(
  bucket: keyof typeof LIMITS,
  opts: RateLimitOptions = {},
): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const cfg = LIMITS[bucket];
    const user = c.get("user");
    const identifier = user?.id ?? clientIp(c);
    const suffix = opts.keySuffix ? `:${opts.keySuffix}` : "";

    const windowStart = Math.floor(Date.now() / 1000 / cfg.window_sec);
    const key = `ratelimit:${identifier}${suffix}:${bucket}:${windowStart}`;

    const redis = getRedis();
    const count = await redis.incr(key);
    if (count === 1) {
      // Window TTL with a small grace so the key auto-expires even if the
      // request handler crashes before completion.
      await redis.expire(key, cfg.window_sec + 5);
    }

    if (count > cfg.max) {
      const retryAfter = cfg.window_sec;
      return c.json(
        {
          error: "rate_limited",
          message: `Too many requests. Try again in ${Math.ceil(retryAfter / 60)} minute(s).`,
        },
        429,
        { "Retry-After": String(retryAfter) },
      );
    }

    await next();
  };
}

/**
 * Helper: rate-limit a single auth action by IP + email combination.
 * Use inside the route handler AFTER parsing the body to access `email`.
 *
 * Returns null on success, or a Response to short-circuit with on 429.
 */
export async function checkAuthRateLimit(
  c: Context<AppBindings>,
  bucket: "auth" | "signup",
  email: string,
): Promise<Response | null> {
  const cfg = LIMITS[bucket];
  const ip = clientIp(c);
  const windowStart = Math.floor(Date.now() / 1000 / cfg.window_sec);
  const key = `ratelimit:${ip}:${email.toLowerCase()}:${bucket}:${windowStart}`;

  const redis = getRedis();
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, cfg.window_sec + 5);
  }
  if (count > cfg.max) {
    return c.json(
      {
        error: "rate_limited",
        message: `Too many attempts. Try again in ${Math.ceil(cfg.window_sec / 60)} minute(s).`,
      },
      429,
      { "Retry-After": String(cfg.window_sec) },
    );
  }
  return null;
}
