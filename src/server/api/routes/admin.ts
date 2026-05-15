/**
 * Admin routes — gated by requireAdmin (mount AFTER requireAuth).
 *
 * Read-only ops dashboard. Returns enough state to debug user accounts,
 * inspect every meeting's processing status, and watch the BullMQ queue.
 */

import { Hono } from "hono";
import { requireAdmin } from "../middleware/auth";
import { getSql } from "../../db";
import { getProcessingQueue, getQueueConnection } from "../../services/queue";
import { getEnv } from "../../env";
import type { AppBindings } from "../types";
import type Redis from "ioredis";

const admin = new Hono<AppBindings>();
admin.use("*", requireAdmin);

interface AdminUserRow {
  id: string;
  email: string;
  name: string | null;
  is_admin: boolean;
  has_password: boolean;
  meeting_count: number;
  created_at: string;
}

admin.get("/users", async (c) => {
  const sql = getSql();
  const rows = await sql<AdminUserRow[]>`
    SELECT u.id,
           u.email,
           u.name,
           u.is_admin,
           (u.password_hash IS NOT NULL) AS has_password,
           COALESCE(mc.cnt, 0)::int AS meeting_count,
           u.created_at
    FROM users u
    LEFT JOIN (
      SELECT user_id, COUNT(*) AS cnt
      FROM meetings
      GROUP BY user_id
    ) mc ON mc.user_id = u.id
    ORDER BY u.created_at DESC
  `;
  return c.json({ items: rows });
});

interface AdminMeetingRow {
  id: string;
  title: string;
  status: string;
  duration_sec: number | null;
  failure_reason: string | null;
  user_email: string;
  created_at: string;
}

admin.get("/meetings", async (c) => {
  const sql = getSql();
  const rows = await sql<AdminMeetingRow[]>`
    SELECT m.id,
           m.title,
           m.status,
           m.duration_sec,
           m.failure_reason,
           u.email AS user_email,
           m.created_at
    FROM meetings m
    JOIN users u ON u.id = m.user_id
    ORDER BY m.created_at DESC
    LIMIT 200
  `;
  return c.json({ items: rows });
});

admin.get("/queue", async (c) => {
  const queue = getProcessingQueue();
  const counts = await queue.getJobCounts("waiting", "active", "completed", "failed", "delayed");
  // Most recent failed jobs (helpful for debugging)
  const failedJobs = await queue.getFailed(0, 9);
  const failed = failedJobs.map((j) => ({
    id: j.id,
    name: j.name,
    failed_reason: j.failedReason,
    attempts_made: j.attemptsMade,
    failed_at: j.finishedOn ? new Date(j.finishedOn).toISOString() : null,
  }));
  return c.json({ counts, recent_failed: failed });
});

admin.get("/system", async (c) => {
  const env = getEnv();
  const sql = getSql();

  const services: Array<{ name: string; status: "ok" | "fail" | "skipped"; latency_ms: number | null; detail?: string }> = [];

  // Postgres
  const t1 = performance.now();
  try {
    await sql`SELECT 1`;
    services.push({ name: "Postgres", status: "ok", latency_ms: Math.round(performance.now() - t1) });
  } catch (err) {
    services.push({ name: "Postgres", status: "fail", latency_ms: null, detail: err instanceof Error ? err.message : "error" });
  }

  // Redis (via BullMQ's own connection — that's what the worker uses)
  const t2 = performance.now();
  try {
    const conn = getQueueConnection() as unknown as Redis;
    const pong = await conn.ping();
    services.push({ name: "Redis", status: pong === "PONG" ? "ok" : "fail", latency_ms: Math.round(performance.now() - t2) });
  } catch (err) {
    services.push({ name: "Redis", status: "fail", latency_ms: null, detail: err instanceof Error ? err.message : "error" });
  }

  // BullMQ workers
  try {
    const queue = getProcessingQueue();
    const workers = await queue.getWorkers();
    services.push({
      name: "Worker",
      status: workers.length > 0 ? "ok" : "fail",
      latency_ms: null,
      detail: `${workers.length} worker(s) connected`,
    });
  } catch (err) {
    services.push({ name: "Worker", status: "fail", latency_ms: null, detail: err instanceof Error ? err.message : "error" });
  }

  // R2 (not pinged here — adding a HEAD would burn class-A ops; we surface config presence)
  services.push({
    name: "R2",
    status: env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_ACCOUNT_ID ? "ok" : "fail",
    latency_ms: null,
    detail: env.R2_BUCKET,
  });

  // External APIs — config presence only
  services.push({
    name: "OpenAI",
    status: env.OPENAI_API_KEY ? "ok" : "skipped",
    latency_ms: null,
    detail: env.OPENAI_MODEL_PRIMARY,
  });
  services.push({
    name: "AssemblyAI",
    status: env.ASSEMBLYAI_API_KEY ? "ok" : "skipped",
    latency_ms: null,
    detail: env.ASSEMBLYAI_API_KEY ? "configured" : "not set",
  });

  return c.json({
    services,
    runtime: {
      node_version: process.version,
      uptime_seconds: Math.round(process.uptime()),
      env: env.NODE_ENV,
      app_url: env.APP_URL,
      api_port: env.PORT,
      pid: process.pid,
      memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    },
  });
});

export default admin;
