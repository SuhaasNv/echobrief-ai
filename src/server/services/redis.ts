/**
 * Redis (Railway) — connection pool for caching + rate limiting.
 *
 * BullMQ keeps its own connection pool (see queue.ts), so this pool is
 * used only for KV-style cache operations (rate limits, session cache).
 *
 * SCALABILITY: Connection pooling for production load.
 * - 10 connections per API instance (up from 1)
 * - Round-robin load balancing across pool
 * - Fail-fast timeouts (5s connect, 3s command)
 *
 * Environment Variables:
 * - REDIS_POOL_SIZE: Number of connections in pool (default: 10)
 */

import Redis, { type Redis as RedisClient } from "ioredis";
import { getEnv } from "../env";

let _redisPool: RedisClient[] = [];
let _poolIndex = 0;

// SCALABILITY: Configurable pool size; test environments use 1 to avoid connection noise
const POOL_SIZE =
  process.env.NODE_ENV === "test" ? 1 : parseInt(process.env.REDIS_POOL_SIZE || "10");

export function getRedis(): RedisClient {
  // Initialize pool on first call
  if (_redisPool.length === 0) {
    const env = getEnv();

    console.log(`[Redis] Initializing connection pool with ${POOL_SIZE} connections`);

    for (let i = 0; i < POOL_SIZE; i++) {
      const client = new Redis(env.REDIS_URL, {
        maxRetriesPerRequest: 3, // Retry up to 3 times (instead of null)
        enableReadyCheck: true, // Check connection health
        lazyConnect: false, // Connect immediately
        connectTimeout: 5000, // 5s connect timeout (fail fast)
        commandTimeout: 3000, // 3s command timeout (prevent hangs)
        retryStrategy: (times) => {
          // Exponential backoff: 50ms, 100ms, 200ms, ...
          return Math.min(times * 50, 2000);
        },

        // SCALABILITY: Enable performance optimizations
        enableOfflineQueue: true, // Queue commands while reconnecting
        enableAutoPipelining: true, // Batch commands automatically
      });

      client.on("error", (err) => {
        console.error(`[redis-error] pool[${i}]:`, err.message);
      });

      client.on("ready", () => {
        if (env.NODE_ENV === "development") {
          console.log(`[Redis] pool[${i}] ready`);
        }
      });

      _redisPool.push(client);
    }
  }

  // Round-robin load balancing across pool
  _poolIndex = (_poolIndex + 1) % _redisPool.length;
  return _redisPool[_poolIndex];
}

export async function closeRedis(): Promise<void> {
  if (_redisPool.length > 0) {
    console.log(`[Redis] Closing ${_redisPool.length} connections`);
    await Promise.all(_redisPool.map((client) => client.quit()));
    _redisPool = [];
    _poolIndex = 0;
  }
}

export type { RedisClient };
