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

// ---------------------------------------------------------------------------
// GET /subscription — current tier, status, usage, and limits
// ---------------------------------------------------------------------------
app.get("/", async (c) => {
  const user = c.get("user");
  const workspaceId = c.get("workspaceId");
  const sql = getSql();

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
  return c.json({
    free: {
      name: "Free",
      price_usd: 0,
      annual_price_usd: 0,
      description: "5 hours of transcription and 10 AI queries per month.",
      features: TIER_FEATURES.free,
    },
    student: {
      ...TIER_PRICING.student,
      features: TIER_FEATURES.student,
    },
    pro: {
      ...TIER_PRICING.pro,
      features: TIER_FEATURES.pro,
    },
    team: {
      ...TIER_PRICING.team,
      features: TIER_FEATURES.team,
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

app.post("/upgrade", zValidator("json", UpgradeRequest), async (c) => {
  const { tier, billing_interval } = c.req.valid("json");
  const user = c.get("user");

  // TODO: Integrate Stripe Checkout
  // 1. Create or retrieve Stripe customer
  // 2. Create Stripe Checkout session
  // 3. Return session URL
  //
  // For now, return a placeholder response.

  return c.json({
    message: "Stripe integration pending. Manual upgrade required.",
    tier,
    billing_interval,
    user_id: user.id,
  });
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
