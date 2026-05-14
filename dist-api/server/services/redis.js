/**
 * Redis (Railway) — singleton client for caching + rate limiting.
 *
 * BullMQ keeps its own connection pool (see queue.ts), so this client is
 * used only for KV-style cache operations (rate limits, session cache).
 */
import Redis from "ioredis";
import { getEnv } from "../env";
let _redis = null;
export function getRedis() {
    if (_redis)
        return _redis;
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
export async function closeRedis() {
    if (_redis) {
        await _redis.quit();
        _redis = null;
    }
}
//# sourceMappingURL=redis.js.map