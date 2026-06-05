/**
 * Health check routes for Kubernetes/Railway readiness and liveness probes.
 *
 * Routes:
 * - GET /health - Liveness probe (is the process running?)
 * - GET /ready - Readiness probe (can we serve traffic?)
 *
 * Railway and Kubernetes use these for:
 * - Zero-downtime deployments (wait until /ready returns 200)
 * - Auto-restart unhealthy instances
 * - Load balancer routing decisions
 */

import { Hono } from "hono";
import { getSql } from "../../db";
import { getRedis } from "../../services/redis";

const app = new Hono();

/**
 * Liveness probe - basic process health.
 * Returns 200 as long as the process is running.
 * If this fails, the container should be restarted.
 */
app.get("/health", (c) => {
  return c.json({
    ok: true,
    service: "echobrief-api",
    timestamp: Date.now(),
  });
});

/**
 * Readiness probe - comprehensive service health.
 * Checks all critical dependencies (DB, Redis, Queue).
 * If this fails, traffic should not be routed to this instance.
 */
app.get("/ready", async (c) => {
  const checks: Record<string, boolean> = {};
  const latencies: Record<string, number> = {};

  // Check database
  try {
    const t1 = performance.now();
    const sql = getSql();
    await sql`SELECT 1`;
    checks.database = true;
    latencies.database_ms = Math.round(performance.now() - t1);
  } catch (err) {
    checks.database = false;
    console.error("[Health] Database check failed:", err);
  }

  // Check Redis
  try {
    const t2 = performance.now();
    const redis = getRedis();
    const pong = await redis.ping();
    checks.redis = pong === "PONG";
    latencies.redis_ms = Math.round(performance.now() - t2);
  } catch (err) {
    checks.redis = false;
    console.error("[Health] Redis check failed:", err);
  }

  // Overall readiness: all checks must pass
  const ready = Object.values(checks).every(Boolean);

  // Return 503 if not ready (tells load balancer to route elsewhere)
  return c.json(
    {
      ready,
      checks,
      latencies,
      timestamp: Date.now(),
    },
    ready ? 200 : 503,
  );
});

export default app;
