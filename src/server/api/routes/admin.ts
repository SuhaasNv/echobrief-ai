/**
 * Admin routes — gated by requireAdmin (mount AFTER requireAuth).
 *
 * Read-only ops dashboard. Returns enough state to debug user accounts,
 * inspect every meeting's processing status, and watch the BullMQ queue.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAdmin } from "../middleware/auth";
import { getSql } from "../../db";
import { getProcessingQueue, getQueueConnection } from "../../services/queue";
import { getEnv } from "../../env";
import type { AppBindings } from "../types";
import type Redis from "ioredis";
import adminWorkerRoutes from "./admin-workers";

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
  tier: string | null;
  subscription_status: string | null;
  stripe_customer_id: string | null;
  billing_interval: string | null;
  current_period_end: Date | null;
  price_usd: number | null;
}

// GET /admin/users — list all users with subscription data
admin.get("/users", async (c) => {
  const sql = getSql();
  const rows = await sql<AdminUserRow[]>`
    SELECT u.id,
           u.email,
           u.name,
           u.is_admin,
           (u.password_hash IS NOT NULL) AS has_password,
           COALESCE(mc.cnt, 0)::int AS meeting_count,
           u.created_at,
           s.tier,
           s.status AS subscription_status,
           s.stripe_customer_id,
           s.billing_interval,
           s.current_period_end,
           s.price_usd
    FROM users u
    LEFT JOIN subscriptions s ON s.user_id = u.id
    LEFT JOIN (
      SELECT user_id, COUNT(*) AS cnt
      FROM meetings
      GROUP BY user_id
    ) mc ON mc.user_id = u.id
    ORDER BY u.created_at DESC
  `;
  return c.json({ items: rows });
});

// GET /admin/users/:id — detailed user view with subscription and usage history
admin.get("/users/:id", async (c) => {
  const userId = c.req.param("id");
  const sql = getSql();

  // Get user with subscription details
  const userRows = await sql<
    Array<{
      id: string;
      email: string;
      name: string | null;
      avatar_url: string | null;
      is_admin: boolean;
      has_password: boolean;
      created_at: string;
      updated_at: string;
      tier: string | null;
      subscription_status: string | null;
      stripe_customer_id: string | null;
      stripe_subscription_id: string | null;
      billing_interval: string | null;
      current_period_start: Date | null;
      current_period_end: Date | null;
      price_usd: number | null;
      edu_email_verified: boolean | null;
    }>
  >`
    SELECT u.id,
           u.email,
           u.name,
           u.avatar_url,
           u.is_admin,
           (u.password_hash IS NOT NULL) AS has_password,
           u.created_at,
           u.updated_at,
           s.tier,
           s.status AS subscription_status,
           s.stripe_customer_id,
           s.stripe_subscription_id,
           s.billing_interval,
           s.current_period_start,
           s.current_period_end,
           s.price_usd,
           s.edu_email_verified
    FROM users u
    LEFT JOIN subscriptions s ON s.user_id = u.id
    WHERE u.id = ${userId}
  `;

  if (userRows.length === 0) {
    return c.json({ error: "not_found", message: "User not found" }, 404);
  }

  // Get usage history (last 6 months)
  const usageRows = await sql<
    Array<{
      period: string;
      transcription_minutes: number;
      ai_queries_count: number;
      flashcards_generated: number;
      total_cost_usd: number;
    }>
  >`
    SELECT period,
           transcription_minutes,
           ai_queries_count,
           flashcards_generated,
           total_cost_usd
    FROM usage_logs
    WHERE user_id = ${userId}
    ORDER BY period DESC
    LIMIT 6
  `;

  return c.json({
    user: userRows[0],
    usage_history: usageRows,
  });
});

// PATCH /admin/users/:id — update user name and is_admin flag
const UpdateUserSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  is_admin: z.boolean().optional(),
  // Note: Don't allow email changes (auth identifier)
});

admin.patch("/users/:id", zValidator("json", UpdateUserSchema), async (c) => {
  const userId = c.req.param("id");
  const updates = c.req.valid("json");
  const sql = getSql();
  const currentAdmin = c.get("user");

  // Prevent admin from removing their own admin status
  if (userId === currentAdmin.id && updates.is_admin === false) {
    return c.json(
      {
        error: "forbidden",
        message: "Cannot remove your own admin privileges",
      },
      403,
    );
  }

  // Build dynamic UPDATE
  const sets = [];
  if (updates.name !== undefined) sets.push(sql`name = ${updates.name}`);
  if (updates.is_admin !== undefined) sets.push(sql`is_admin = ${updates.is_admin}`);

  if (sets.length === 0) return c.json({ ok: true });

  const setClause = sets.reduce((acc, cur, i) => (i === 0 ? cur : sql`${acc}, ${cur}`));

  await sql`
    UPDATE users 
    SET ${setClause}, updated_at = now() 
    WHERE id = ${userId}
  `;

  return c.json({ ok: true });
});

// PATCH /admin/users/:id/subscription — update subscription tier and status
const UpdateSubscriptionSchema = z.object({
  tier: z.enum(["free", "student", "pro", "team"]),
  status: z.enum(["active", "cancelled", "past_due", "trialing"]).optional(),
});

admin.patch("/users/:id/subscription", zValidator("json", UpdateSubscriptionSchema), async (c) => {
  const userId = c.req.param("id");
  const { tier, status } = c.req.valid("json");
  const sql = getSql();

  // Check if subscription exists
  const existing = await sql<Array<{ id: string }>>`
    SELECT id FROM subscriptions WHERE user_id = ${userId}
  `;

  if (existing.length === 0) {
    // Create subscription if missing
    await sql`
      INSERT INTO subscriptions (user_id, tier, status)
      VALUES (${userId}, ${tier}, ${status || "active"})
    `;
  } else {
    // Update existing
    const updates = [sql`tier = ${tier}`];
    if (status) updates.push(sql`status = ${status}`);

    const setClause = updates.reduce((acc, cur, i) => (i === 0 ? cur : sql`${acc}, ${cur}`));

    await sql`
      UPDATE subscriptions 
      SET ${setClause}, updated_at = now()
      WHERE user_id = ${userId}
    `;
  }

  return c.json({ ok: true });
});

// DELETE /admin/users/:id — delete user with safety checks
admin.delete("/users/:id", async (c) => {
  const userId = c.req.param("id");
  const sql = getSql();
  const currentAdmin = c.get("user");

  // Prevent self-deletion
  if (userId === currentAdmin.id) {
    return c.json(
      {
        error: "forbidden",
        message: "Cannot delete your own account",
      },
      403,
    );
  }

  // Check if user exists
  const user = await sql<Array<{ id: string; email: string; is_admin: boolean }>>`
    SELECT id, email, is_admin FROM users WHERE id = ${userId}
  `;

  if (user.length === 0) {
    return c.json({ error: "not_found", message: "User not found" }, 404);
  }

  // Warn if deleting another admin (require confirmation)
  if (user[0].is_admin) {
    const confirmed = c.req.query("confirm") === "true";
    if (!confirmed) {
      return c.json(
        {
          error: "confirmation_required",
          message: "This is an admin user. Add ?confirm=true to proceed",
        },
        400,
      );
    }
  }

  // Delete user (CASCADE handles related records: subscriptions, meetings, etc.)
  await sql`DELETE FROM users WHERE id = ${userId}`;

  return c.json({
    ok: true,
    deleted_email: user[0].email,
  });
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

  const services: Array<{
    name: string;
    status: "ok" | "fail" | "skipped";
    latency_ms: number | null;
    detail?: string;
  }> = [];

  // Postgres
  const t1 = performance.now();
  try {
    await sql`SELECT 1`;
    services.push({
      name: "Postgres",
      status: "ok",
      latency_ms: Math.round(performance.now() - t1),
    });
  } catch (err) {
    services.push({
      name: "Postgres",
      status: "fail",
      latency_ms: null,
      detail: err instanceof Error ? err.message : "error",
    });
  }

  // Redis (via BullMQ's own connection — that's what the worker uses)
  const t2 = performance.now();
  try {
    const conn = getQueueConnection() as unknown as Redis;
    const pong = await conn.ping();
    services.push({
      name: "Redis",
      status: pong === "PONG" ? "ok" : "fail",
      latency_ms: Math.round(performance.now() - t2),
    });
  } catch (err) {
    services.push({
      name: "Redis",
      status: "fail",
      latency_ms: null,
      detail: err instanceof Error ? err.message : "error",
    });
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
    services.push({
      name: "Worker",
      status: "fail",
      latency_ms: null,
      detail: err instanceof Error ? err.message : "error",
    });
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

// Mount worker monitoring routes
admin.route("/workers", adminWorkerRoutes);

export default admin;
