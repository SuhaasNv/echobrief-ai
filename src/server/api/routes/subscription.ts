/**
 * /api/v1/subscription — subscription and usage management
 *
 * Endpoints:
 *   GET  /api/v1/subscription        — get current subscription + usage
 *   POST /api/v1/subscription/upgrade — initiate Stripe checkout (future)
 *   POST /api/v1/subscription/cancel  — cancel subscription (future)
 */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { getSql } from "../../db";
import { getCurrentUsage, getUserTier } from "../../services/usage-tracker";
import { TIER_FEATURES, TIER_PRICING } from "../../../lib/features";
import type { AppBindings } from "../types";

const app = new Hono<AppBindings>();

/**
 * Resolve the caller's active workspace without requireWorkspace: trust the
 * header only if the user is actually a member, else fall back to their oldest
 * workspace. Returns null when the user has none yet.
 */
async function resolveActiveWorkspaceId(
  userId: string,
  headerId: string | undefined,
): Promise<string | null> {
  const sql = getSql();
  if (headerId) {
    const rows = await sql<{ workspace_id: string }[]>`
      SELECT workspace_id FROM workspace_members
      WHERE workspace_id = ${headerId} AND user_id = ${userId}
      LIMIT 1
    `;
    if (rows.length > 0) return rows[0].workspace_id;
  }
  const rows = await sql<{ id: string }[]>`
    SELECT w.id FROM workspaces w
    JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = ${userId}
    ORDER BY w.created_at ASC
    LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// GET /subscription — current tier, status, usage, and limits
// ---------------------------------------------------------------------------
app.get("/", async (c) => {
  const user = c.get("user");
  const sql = getSql();

  // This route is mounted OUTSIDE requireWorkspace (you can read your plan
  // without an active workspace), so c.get("workspaceId") is undefined here.
  // Passing undefined to getCurrentUsage hit its `= null` default parameter and
  // silently took the account-wide branch, making workspace_usage a duplicate
  // of usage. Resolve the active workspace the same way requireWorkspace does.
  const workspaceId = await resolveActiveWorkspaceId(
    user.id,
    c.req.header("x-workspace-id")?.trim(),
  );

  // Get subscription details
  const subscriptionRows = await sql<
    Array<{
      tier: string;
      status: string;
      stripe_customer_id: string | null;
      stripe_subscription_id: string | null;
      billing_interval: string | null;
      current_period_start: Date | null;
      current_period_end: Date | null;
      price_usd: number | null;
      edu_email_verified: boolean;
    }>
  >`
    SELECT 
      tier, status, stripe_customer_id, stripe_subscription_id,
      billing_interval, current_period_start, current_period_end,
      price_usd, edu_email_verified
    FROM subscriptions
    WHERE user_id = ${user.id}
    LIMIT 1
  `;

  const subscription = subscriptionRows[0] ?? {
    tier: "free",
    status: "active",
    stripe_customer_id: null,
    stripe_subscription_id: null,
    billing_interval: null,
    current_period_start: null,
    current_period_end: null,
    price_usd: null,
    edu_email_verified: false,
  };

  // Get current usage (aggregate across all workspaces)
  const usage = await getCurrentUsage(user.id);

  // Get workspace usage (for current workspace)
  const workspaceUsage = await getCurrentUsage(user.id, workspaceId);

  // Get workspace count
  const [{ workspace_count }] = await sql<[{ workspace_count: number }]>`
    SELECT COUNT(*)::int AS workspace_count
    FROM workspaces
    WHERE owner_id = ${user.id}
  `;

  const tier = subscription.tier as "free" | "student" | "pro" | "team";
  const features = TIER_FEATURES[tier];

  return c.json({
    subscription: {
      tier: subscription.tier,
      status: subscription.status,
      billing_interval: subscription.billing_interval,
      current_period_start: subscription.current_period_start,
      current_period_end: subscription.current_period_end,
      price_usd: subscription.price_usd,
      edu_email_verified: subscription.edu_email_verified,
    },
    usage: {
      period: usage.period,
      transcription_minutes: usage.transcription_minutes,
      ai_queries_count: usage.ai_queries_count,
      flashcards_generated: usage.flashcards_generated,
      total_cost_usd: Number(usage.total_cost_usd),
      workspace_count,
    },
    workspace_usage: {
      transcription_minutes: workspaceUsage.transcription_minutes,
      ai_queries_count: workspaceUsage.ai_queries_count,
      flashcards_generated: workspaceUsage.flashcards_generated,
    },
    limits: {
      transcription_minutes: features.transcription_minutes,
      ai_queries: features.ai_queries,
      flashcards_per_lecture: features.flashcards_per_lecture,
      workspaces: features.workspaces,
    },
    features: {
      integrations: features.integrations,
      email_generation: features.email_generation,
      flashcards: features.flashcards,
      unlimited_history: features.unlimited_history,
      shared_workspaces: features.shared_workspaces,
      history_retention_days: features.history_retention_days,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /subscription/pricing — tier pricing info (for upgrade modal)
// ---------------------------------------------------------------------------
app.get("/pricing", async (c) => {
  /**
   * Only what is actually for sale.
   *
   * `student` and `team` still exist in the type and keep working for any
   * account already on one — they are simply not offered. Listing a plan nobody
   * can buy is a support ticket waiting to happen, and `team` in particular
   * would be selling shared workspaces that do not exist.
   *
   * The Free description is generated from TIER_FEATURES rather than written
   * out. It previously read "5 hours of transcription and 10 AI queries" — both
   * numbers stale the moment the limits moved, which they just did, and a
   * pricing page that misstates the free tier is the worst place to be wrong.
   */
  const freeMinutes = TIER_FEATURES.free.transcription_minutes;
  const freeQueries = TIER_FEATURES.free.ai_queries;

  return c.json({
    free: {
      name: "Free",
      price_usd: 0,
      annual_price_usd: 0,
      description: `${freeMinutes ? `${Math.round(freeMinutes / 60)} hours` : "Unlimited"} of transcription and ${freeQueries ?? "unlimited"} AI questions per month.`,
      features: TIER_FEATURES.free,
    },
    pro: {
      ...TIER_PRICING.pro,
      features: TIER_FEATURES.pro,
    },
  });
});

// ---------------------------------------------------------------------------
// POST /subscription/upgrade — initiate Stripe checkout (placeholder)
// ---------------------------------------------------------------------------
const UpgradeRequest = z.object({
  tier: z.enum(["student", "pro", "team"]),
  billing_interval: z.enum(["monthly", "annual"]),
});

/**
 * Gone, and answering 410 rather than 200.
 *
 * This used to return `{ message: "Stripe integration pending" }` with a 200,
 * which is the worst of both worlds: a client cannot tell success from
 * not-implemented, and an integration test asserting that exact string made the
 * stub load-bearing — the string could not be changed without failing CI, so it
 * looked maintained.
 *
 * Upgrades happen through Apple IAP now. The purchase is made by the StoreKit
 * sheet on the device and entitlement arrives via the RevenueCat webhook; there
 * is no server-initiated checkout to start, and there must not be one. Selling a
 * subscription for iOS content outside Apple's IAP is an App Store rejection.
 */
app.post("/upgrade", zValidator("json", UpgradeRequest), (c) => {
  return c.json(
    {
      error: "gone",
      message:
        "Upgrades are handled in the app through the App Store. Open Account > Plan to subscribe.",
    },
    410,
  );
});

// ---------------------------------------------------------------------------
// POST /subscription/cancel — cancel active subscription (placeholder)
// ---------------------------------------------------------------------------
app.post("/cancel", async (c) => {
  const user = c.get("user");
  const sql = getSql();

  const rows = await sql<
    Array<{ tier: string; status: string; stripe_subscription_id: string | null }>
  >`
    SELECT tier, status, stripe_subscription_id
    FROM subscriptions
    WHERE user_id = ${user.id}
    LIMIT 1
  `;

  const subscription = rows[0];
  if (!subscription || subscription.tier === "free") {
    throw new HTTPException(400, { message: "No active subscription to cancel" });
  }

  // TODO: Integrate Stripe cancellation
  // 1. Cancel Stripe subscription
  // 2. Update subscription status to 'cancelled'
  //
  // For now, just update the status locally.

  await sql`
    UPDATE subscriptions
    SET status = 'cancelled', updated_at = now()
    WHERE user_id = ${user.id}
  `;

  return c.json({ message: "Subscription cancelled successfully" });
});

export default app;
