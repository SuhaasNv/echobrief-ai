/**
 * Redis-backed sliding-window rate limiter with tier-based limits.
 *
 * Keys: ratelimit:{user_id|ip}:{bucket}:{window}
 *
 * Buckets:
 *   - general — Tier-based limits (free: 100, student: 300, pro: 500, team: 2000 req/min)
 *   - ai      — Tier-based limits (free: 10, student: 50, pro: 100, team: 500 req/min)
 *   - auth    — 5 attempts / 15min / (IP + email) — login bruteforce defense
 *   - signup  — 3 signups / hour / IP — signup spam defense
 *
 * The auth bucket also accepts an explicit `keySuffix` so the caller can mix
 * email into the identifier (so per-account brute-force is throttled even
 * if attacker rotates IPs).
 */

import type { MiddlewareHandler, Context } from "hono";
import { getRedis } from "../../services/redis";
import { getUserTier, type SubscriptionTier } from "../../services/usage-tracker";
import { logRateLimit } from "../../lib/logger";
import type { AppBindings } from "../types";
import type { IncomingMessage } from "node:http";

interface BucketConfig {
  max: number;
  window_sec: number;
}

// Base limits (for non-authenticated or fixed-bucket endpoints)
const LIMITS: Record<string, BucketConfig> = {
  general: { max: 100, window_sec: 60 },
  ai: { max: 10, window_sec: 60 },
  auth: { max: 5, window_sec: 60 * 15 },
  signup: { max: 3, window_sec: 60 * 60 },
};

// Tier-based limits (for authenticated users)
const TIER_LIMITS: Record<SubscriptionTier, Record<string, BucketConfig>> = {
  free: {
    general: { max: 100, window_sec: 60 },
    ai: { max: 10, window_sec: 60 },
  },
  student: {
    general: { max: 300, window_sec: 60 },
    ai: { max: 50, window_sec: 60 },
  },
  pro: {
    general: { max: 500, window_sec: 60 },
    ai: { max: 100, window_sec: 60 },
  },
  team: {
    general: { max: 2000, window_sec: 60 },
    ai: { max: 500, window_sec: 60 },
  },
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
export function clientIp<E extends { Variables: AppBindings["Variables"] }>(c: Context<E>): string {
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
    // Bypass rate limiting in test environments to prevent CI flakiness
    // (all test workers share the same runner IP + Redis instance)
    if (process.env.NODE_ENV === "test") {
      await next();
      return;
    }

    const user = c.get("user");
    const identifier = user?.id ?? clientIp(c);
    const suffix = opts.keySuffix ? `:${opts.keySuffix}` : "";

    // Get tier-specific limits for authenticated users
    let cfg = LIMITS[bucket];
    if (user && (bucket === "general" || bucket === "ai")) {
      try {
        const tier = await getUserTier(user.id);
        cfg = TIER_LIMITS[tier]?.[bucket] ?? cfg;
      } catch (err) {
        // Fall back to base limits if getUserTier fails
        console.warn("[RateLimit] Failed to get user tier, using base limits:", err);
      }
    }

    const windowStart = Math.floor(Date.now() / 1000 / cfg.window_sec);
    const key = `ratelimit:${identifier}${suffix}:${bucket}:${windowStart}`;

    const redis = getRedis();
    const count = await redis.incr(key);
    if (count === 1) {
      // Window TTL with a small grace so the key auto-expires even if the
      // request handler crashes before completion.
      await redis.expire(key, cfg.window_sec + 5);
    }

    // Calculate rate limit info for headers
    const remaining = Math.max(0, cfg.max - count);
    const resetTime = (windowStart + 1) * cfg.window_sec;

    // SECURITY: Always return rate limit headers (RFC 6585 standard)
    // Helps clients implement proper retry logic and avoid hammering the API
    c.header("X-RateLimit-Limit", String(cfg.max));
    c.header("X-RateLimit-Remaining", String(remaining));
    c.header("X-RateLimit-Reset", String(resetTime));

    if (count > cfg.max) {
      const retryAfter = cfg.window_sec;
      const ip = clientIp(c);

      // Log security event for rate limit violation
      logRateLimit(bucket, identifier, count, cfg.max, ip);

      return c.json(
        {
          error: "rate_limited",
          message: `Too many requests. Try again in ${Math.ceil(retryAfter / 60)} minute(s).`,
          retry_after_seconds: retryAfter, // Machine-readable for client retry logic
          limit: cfg.max,
          window_seconds: cfg.window_sec,
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
  // Bypass rate limiting in test environments
  if (process.env.NODE_ENV === "test") return null;

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
