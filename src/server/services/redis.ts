/**
 * Redis (Railway) — singleton client for caching + rate limiting.
 *
 * BullMQ keeps its own connection pool (see queue.ts), so this client is
 * used only for KV-style cache operations (rate limits, session cache).
 */

import Redis, { type Redis as RedisClient } from "ioredis";
import { getEnv } from "../env";

let _redis: RedisClient | null = null;

export function getRedis(): RedisClient {
  if (_redis) return _redis;
  const env = getEnv();
  _redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null, // required for BullMQ-compatible clients
    enableReadyCheck: false,
    lazyConnect: false,
  });
  _redis.on("error", (err) => {
    console.error("[redis-error]", err.message);
  });
  return _redis;
}

export async function closeRedis(): Promise<void> {
  if (_redis) {
    await _redis.quit();
    _redis = null;
  }
}

export type { RedisClient };
