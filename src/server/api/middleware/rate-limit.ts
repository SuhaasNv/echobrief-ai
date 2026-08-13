/**
 * Redis-backed fixed-window rate limiter with tier-based limits.
 *
 * Keys: ratelimit:{user_id|ip}:{bucket}:{window}
 *
 * Buckets:
 *   - general — Tier-based limits (free: 100, student: 300, pro: 500, team: 2000 req/min)
 *   - ai      — Tier-based limits (free: 10, student: 50, pro: 100, team: 500 req/min)
 *   - upload  — 20 upload-URL / transcript-ingest calls per hour per user. Each
 *               one can turn into a 4-hour AssemblyAI job, so this is a money
 *               budget, not a traffic budget, and it is deliberately much
 *               tighter than `general`.
 *   - auth_ip — 30 auth requests / 15min / IP. Blanket cap on the whole /auth
 *               surface (login, signup, Google SSO round-trips) so one host
 *               can't spray thousands of credentials across many accounts.
 *   - auth    — 5 attempts / 15min / (IP + email) — login bruteforce defense
 *   - auth_account — 10 attempts / 15min / email ALONE. The (IP + email) bucket
 *               above resets the moment an attacker rotates source IPs, which is
 *               trivial with a proxy pool; this one does not, so a single
 *               account cannot be ground down regardless of where the traffic
 *               comes from.
 *   - signup  — 3 signups / hour / IP — signup spam defense
 *   - share   — 60 req/min/IP on the public, unauthenticated share endpoint.
 *
 * FAIL-OPEN vs FAIL-CLOSED WHEN REDIS IS DOWN
 * -------------------------------------------
 * A limiter that swallows Redis errors and calls next() is the classic version
 * of this bug: an attacker who can knock Redis over (or who simply gets lucky
 * during an outage) gets an unmetered API. But failing closed on *everything*
 * turns a cache outage into a total outage. So the decision is per route class:
 *
 *   general → FAIL OPEN. These are authenticated reads of the caller's own
 *     rows. The worst case is extra Postgres load from an already-authenticated
 *     account, which is bounded and attributable. Availability wins.
 *
 *   ai / upload / auth / auth_ip / auth_account / signup / share → FAIL CLOSED
 *     (503). Every one of these either spends money per request (OpenAI,
 *     AssemblyAI, R2) or is the unauthenticated edge of the system. An
 *     unmetered credential-stuffing window or an unmetered LLM window is worse
 *     than a few minutes of 503s on those specific endpoints.
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
const LIMITS = {
  general: { max: 100, window_sec: 60 },
  ai: { max: 10, window_sec: 60 },
  upload: { max: 20, window_sec: 60 * 60 },
  auth: { max: 5, window_sec: 60 * 15 },
  auth_ip: { max: 30, window_sec: 60 * 15 },
  auth_account: { max: 10, window_sec: 60 * 15 },
  signup: { max: 3, window_sec: 60 * 60 },
  share: { max: 60, window_sec: 60 },
  // Its OWN bucket, and deliberately not `general` — general is the one
  // fail-open bucket in the system, and an unauthenticated endpoint that writes
  // subscription tiers must never fall open when Redis is unreachable. Sized for
  // real traffic: RevenueCat retries with backoff, and a handful of paying users
  // produces a few events a day, not a few a second.
  webhook: { max: 120, window_sec: 60 },
} satisfies Record<string, BucketConfig>;

export type RateLimitBucket = keyof typeof LIMITS;

/** See the FAIL-OPEN vs FAIL-CLOSED note in the file header. */
const FAIL_OPEN_BUCKETS: ReadonlySet<RateLimitBucket> = new Set<RateLimitBucket>(["general"]);

// Tier-based limits (for authenticated users)
const TIER_LIMITS: Record<SubscriptionTier, Partial<Record<RateLimitBucket, BucketConfig>>> = {
  free: {
    general: { max: 100, window_sec: 60 },
    ai: { max: 10, window_sec: 60 },
  },
  // Not sold (see SELLABLE_TIERS) but still resolvable, so an existing account
  // on one of these keeps its budget rather than falling back to the base limit.
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
 * Best-effort client IP.
 *
 * SECURITY: only the hop written by *our own* edge can be trusted. Proxies
 * APPEND to X-Forwarded-For, so the LEFTMOST entry is whatever the client sent
 * — which means reading `xff.split(",")[0]` lets any caller mint a fresh
 * rate-limit bucket per request by sending `X-Forwarded-For: <random>`. We
 * therefore count in from the RIGHT: with `TRUSTED_PROXY_HOPS` proxies in front
 * of us (Railway's edge = 1, the default), the entry that many places from the
 * end is the address our edge actually observed.
 *
 * `cf-connecting-ip` is only meaningful when traffic is forced through
 * Cloudflare; if it isn't, the header is pure client input. It is ignored
 * unless TRUST_CF_CONNECTING_IP=true is set explicitly.
 *
 * Hono's node adapter exposes the raw IncomingMessage via env.incoming.
 */
export function clientIp<E extends { Variables: AppBindings["Variables"] }>(c: Context<E>): string {
  if (process.env.TRUST_CF_CONNECTING_IP === "true") {
    const cf = c.req.header("cf-connecting-ip");
    if (cf) return cf.trim();
  }

  const xff = c.req.header("x-forwarded-for");
  if (xff) {
    const hops = xff
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean);
    const configured = Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? "1", 10);
    const trustedHops = Number.isFinite(configured) && configured > 0 ? configured : 1;
    const candidate = hops[Math.max(0, hops.length - trustedHops)];
    if (candidate) return candidate;
  }

  // Node adapter — pull socket IP from the underlying IncomingMessage.
  const env = c.env as { incoming?: IncomingMessage } | undefined;
  const remote = env?.incoming?.socket?.remoteAddress;
  if (remote) return remote;

  return "unknown";
}

/** Thrown when the counter could not be read/written. Callers decide the policy. */
class RateLimiterUnavailable extends Error {}

/** Increment a fixed-window counter. Throws RateLimiterUnavailable if Redis is down. */
async function incrementWindow(key: string, windowSec: number): Promise<number> {
  try {
    const redis = getRedis();
    const count = await redis.incr(key);
    if (count === 1) {
      // Window TTL with a small grace so the key auto-expires even if the
      // request handler crashes before completion.
      await redis.expire(key, windowSec + 5);
    }
    return count;
  } catch (err) {
    throw new RateLimiterUnavailable(err instanceof Error ? err.message : "redis unavailable");
  }
}

function limiterUnavailable<E extends { Variables: AppBindings["Variables"] }>(
  c: Context<E>,
  bucket: RateLimitBucket,
  err: unknown,
): Response {
  console.error(
    `[RateLimit] counter unavailable for bucket '${bucket}' — failing closed:`,
    err instanceof Error ? err.message : err,
  );
  return c.json(
    {
      error: "rate_limiter_unavailable",
      message: "Service temporarily unavailable. Please retry shortly.",
    },
    503,
    { "Retry-After": "30" },
  );
}

interface RateLimitOptions {
  /** Optional value mixed into the bucket key (e.g. email for login). */
  keySuffix?: string;
}

export function rateLimit(
  bucket: RateLimitBucket,
  opts: RateLimitOptions = {},
): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    // Bypass rate limiting in test environments to prevent CI flakiness
    // (all test workers share the same runner IP + Redis instance).
    // Keyed on NODE_ENV only — never on anything a client can set.
    if (process.env.NODE_ENV === "test") {
      await next();
      return;
    }

    const user = c.get("user");
    const identifier = user?.id ?? clientIp(c);
    const suffix = opts.keySuffix ? `:${opts.keySuffix}` : "";

    // Get tier-specific limits for authenticated users
    let cfg: BucketConfig = LIMITS[bucket];
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

    let count: number;
    try {
      count = await incrementWindow(key, cfg.window_sec);
    } catch (err) {
      if (FAIL_OPEN_BUCKETS.has(bucket)) {
        console.error(
          `[RateLimit] counter unavailable for bucket '${bucket}' — failing open:`,
          err instanceof Error ? err.message : err,
        );
        await next();
        return;
      }
      return limiterUnavailable(c, bucket, err);
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
 * Helper: rate-limit a single auth action.
 * Use inside the route handler AFTER parsing the body to access `email`.
 *
 * `auth` checks TWO counters — (IP + email) and email-alone — because the first
 * one alone is defeated by rotating source IPs, and the second one alone would
 * let a single shared-NAT user lock out an entire office after one typo.
 * `signup` is keyed on IP alone; the email is attacker-chosen and worthless as
 * a key there.
 *
 * Returns null on success, or a Response to short-circuit with on 429/503.
 *
 * ANTI-ENUMERATION: the 429 body is identical whether or not the email belongs
 * to a real account — the counters key on the submitted string either way.
 */
export async function checkAuthRateLimit(
  c: Context<AppBindings>,
  bucket: "auth" | "signup",
  email: string,
): Promise<Response | null> {
  // Bypass rate limiting in test environments. NODE_ENV only.
  if (process.env.NODE_ENV === "test") return null;

  const ip = clientIp(c);
  const normalizedEmail = email.trim().toLowerCase();

  const counters: Array<{ bucket: RateLimitBucket; key: string }> =
    bucket === "signup"
      ? [{ bucket: "signup", key: `ratelimit:signup:ip:${ip}` }]
      : [
          { bucket: "auth", key: `ratelimit:auth:ip:${ip}:${normalizedEmail}` },
          { bucket: "auth_account", key: `ratelimit:auth:acct:${normalizedEmail}` },
        ];

  for (const counter of counters) {
    const cfg = LIMITS[counter.bucket];
    const windowStart = Math.floor(Date.now() / 1000 / cfg.window_sec);
    let count: number;
    try {
      count = await incrementWindow(`${counter.key}:${windowStart}`, cfg.window_sec);
    } catch (err) {
      // Auth is fail-closed: an unmetered login endpoint during a Redis outage
      // is a credential-stuffing window.
      return limiterUnavailable(c, counter.bucket, err);
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
  }

  return null;
}
