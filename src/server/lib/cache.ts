/**
 * Redis caching wrapper utilities.
 *
 * Provides:
 * - Automatic cache-aside pattern
 * - TTL-based expiration
 * - Error resilience (fallback to source on cache failure)
 * - JSON serialization/deserialization
 *
 * Usage:
 *   import { withCache, invalidateCache } from "./cache";
 *
 *   const pricing = await withCache(
 *     "pricing:all",
 *     3600, // 1 hour TTL
 *     () => fetchPricingFromDB()
 *   );
 *
 * Cache Keys Convention:
 *   - pricing:* - Pricing data (long TTL: 1 hour)
 *   - subscription:{userId} - User subscription status (medium TTL: 5 min)
 *   - meeting:{meetingId}:summary - Meeting summary (forever, invalidate on edit)
 *   - user:{userId}:tier - User tier (short TTL: 1 min)
 */

import { getRedis } from "../services/redis";

/**
 * Cache-aside pattern: Try to read from cache, fall back to source function.
 *
 * @param key - Redis cache key
 * @param ttlSeconds - Time-to-live in seconds
 * @param fn - Source function to call on cache miss
 * @returns Result from cache or source function
 */
export async function withCache<T>(
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>,
): Promise<T> {
  const redis = getRedis();

  // Try to read from cache
  try {
    const cached = await redis.get(key);
    if (cached) {
      return JSON.parse(cached) as T;
    }
  } catch (err) {
    console.warn(`[Cache] Read failed for key "${key}", falling back to source:`, err);
    // Fall through to source function
  }

  // Cache miss or error - fetch from source
  const result = await fn();

  // Try to write to cache (best-effort)
  try {
    await redis.setex(key, ttlSeconds, JSON.stringify(result));
  } catch (err) {
    console.warn(`[Cache] Write failed for key "${key}":`, err);
    // Don't throw - cache write failure shouldn't break the request
  }

  return result;
}

/**
 * Invalidate a cache key or pattern.
 *
 * @param keyOrPattern - Exact key or pattern with * wildcard
 *
 * Examples:
 *   invalidateCache("pricing:all")                // Invalidate single key
 *   invalidateCache("meeting:abc-123:*")          // Invalidate all keys for meeting
 *   invalidateCache("subscription:*")             // Invalidate all subscriptions
 */
export async function invalidateCache(keyOrPattern: string): Promise<void> {
  const redis = getRedis();

  try {
    if (keyOrPattern.includes("*")) {
      // Pattern - scan and delete all matching keys
      const keys = await redis.keys(keyOrPattern);
      if (keys.length > 0) {
        await redis.del(...keys);
        console.log(`[Cache] Invalidated ${keys.length} keys matching "${keyOrPattern}"`);
      }
    } else {
      // Exact key - simple delete
      await redis.del(keyOrPattern);
    }
  } catch (err) {
    console.error(`[Cache] Invalidation failed for "${keyOrPattern}":`, err);
    // Don't throw - invalidation failure shouldn't break the request
  }
}

/**
 * Invalidate all cache keys for a specific meeting.
 * Useful after meeting updates/deletions.
 */
export async function invalidateMeetingCache(meetingId: string): Promise<void> {
  await invalidateCache(`meeting:${meetingId}:*`);
}

/**
 * Invalidate all cache keys for a specific user.
 * Useful after subscription changes or user updates.
 */
export async function invalidateUserCache(userId: string): Promise<void> {
  await invalidateCache(`user:${userId}:*`);
  await invalidateCache(`subscription:${userId}`);
}

/**
 * Get cache statistics (hits, misses, etc.) if available.
 * Note: Basic Redis doesn't track this per-key, so this is best-effort.
 */
export async function getCacheStats(): Promise<{
  used_memory_human: string;
  keyspace_hits: number;
  keyspace_misses: number;
  hit_rate: number;
}> {
  const redis = getRedis();

  try {
    const info = await redis.info("stats");
    const memory = await redis.info("memory");

    // Parse Redis INFO output
    const parseInfo = (text: string, key: string): string => {
      const match = text.match(new RegExp(`${key}:(.+)`));
      return match ? match[1].trim() : "0";
    };

    const hits = parseInt(parseInfo(info, "keyspace_hits"), 10);
    const misses = parseInt(parseInfo(info, "keyspace_misses"), 10);
    const hitRate = hits + misses > 0 ? hits / (hits + misses) : 0;

    return {
      used_memory_human: parseInfo(memory, "used_memory_human"),
      keyspace_hits: hits,
      keyspace_misses: misses,
      hit_rate: Math.round(hitRate * 100) / 100,
    };
  } catch (err) {
    console.error("[Cache] Failed to get stats:", err);
    return {
      used_memory_human: "unknown",
      keyspace_hits: 0,
      keyspace_misses: 0,
      hit_rate: 0,
    };
  }
}
