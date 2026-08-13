/**
 * /api/v1/admin/billing — grant, revoke, and the revenue dashboard.
 *
 * Mounted under the admin router, so requireAdmin has already run.
 *
 * This exists for two real jobs. The first is comping accounts — handing Pro to
 * a friend testing the app, without a purchase and without pretending there was
 * one. The second is answering "how is this doing" honestly, which turns out to
 * be the harder of the two, because the naive version of that query counts
 * comped accounts as revenue and reports a business that does not exist.
 *
 * The rule the whole file is built around: **a granted subscription is not a
 * sale.** `provider` distinguishes them ('manual' vs 'apple'), every revenue
 * figure filters on it, and the dashboard shows comped accounts as their own
 * number rather than folding them in.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import { getSql } from "../../db";
import type { AppBindings } from "../types";

const app = new Hono<AppBindings>();

/**
 * What a Pro subscription is worth per month, in USD.
 *
 * Annual is $72, which is $6/month recognised — NOT $72 counted in the month it
 * was charged. Reporting a year's cash as one month's revenue makes MRR jump and
 * then collapse, and the collapse looks like churn that never happened.
 */
const MONTHLY_VALUE_USD: Record<string, number> = { monthly: 9, annual: 6 };

// ---------------------------------------------------------------------------
// GET /admin/billing/metrics — the dashboard numbers
// ---------------------------------------------------------------------------
app.get("/metrics", async (c) => {
  const sql = getSql();

  /**
   * One pass over subscriptions, split by how the entitlement was obtained.
   *
   * `status IN ('active','cancelled','grace')` is the definition of "currently
   * entitled": cancelled means auto-renew is off but the period has not ended,
   * and grace is Apple retrying a card. Counting only 'active' would under-report
   * every account that is still being served.
   */
  const [subs] = await sql<
    Array<{
      paying: number;
      comped: number;
      cancelling: number;
      grace: number;
      mrr_usd: number;
    }>
  >`
    SELECT
      COUNT(*) FILTER (
        WHERE provider = 'apple' AND status IN ('active', 'cancelled', 'grace')
      )::int AS paying,
      COUNT(*) FILTER (
        WHERE provider = 'manual' AND tier != 'free'
      )::int AS comped,
      COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelling,
      COUNT(*) FILTER (WHERE status = 'grace')::int AS grace,
      -- The ::numeric casts on the bound values are load-bearing. postgres.js
      -- sends a JS number as an UNTYPED parameter, which Postgres infers as
      -- text; matched against the integer zero branch it fails with "CASE types
      -- integer and text cannot be matched" at execution time, not at deploy
      -- time, so it reaches production as a 500 on the dashboard.
      COALESCE(SUM(
        CASE
          WHEN provider = 'apple' AND status IN ('active', 'cancelled', 'grace')
          THEN CASE WHEN billing_interval = 'annual' THEN ${MONTHLY_VALUE_USD.annual}::numeric
                    ELSE ${MONTHLY_VALUE_USD.monthly}::numeric END
          ELSE 0::numeric
        END
      ), 0)::float AS mrr_usd
    FROM subscriptions
  `;

  const [users] = await sql<Array<{ total: number; new_30d: number; active_30d: number }>>`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS new_30d,
      -- "Active" is defined by having recorded something, not by having logged
      -- in. A login with no recording is not a user of this product.
      (SELECT COUNT(DISTINCT user_id) FROM meetings
        WHERE created_at > now() - interval '30 days')::int AS active_30d
    FROM users
  `;

  const [meetings] = await sql<
    Array<{ total: number; last_30d: number; failed_30d: number; minutes_30d: number }>
  >`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS last_30d,
      COUNT(*) FILTER (
        WHERE status = 'failed' AND created_at > now() - interval '30 days'
      )::int AS failed_30d,
      COALESCE(ROUND(SUM(duration_sec) FILTER (
        WHERE created_at > now() - interval '30 days'
      ) / 60.0), 0)::int AS minutes_30d
    FROM meetings
  `;

  /**
   * Transcription minutes are the direct cost of revenue, so they belong next to
   * it. Without this the dashboard can show growing MRR while the margin goes
   * negative — which is the specific failure mode of a $9 plan sitting on a
   * per-minute API.
   */
  const [cost] = await sql<Array<{ minutes_this_period: number; cost_usd: number }>>`
    SELECT
      COALESCE(SUM(transcription_minutes), 0)::int AS minutes_this_period,
      COALESCE(SUM(total_cost_usd), 0)::float AS cost_usd
    FROM usage_logs
    WHERE period = to_char(now(), 'YYYY-MM')
  `;

  const mrr = subs?.mrr_usd ?? 0;
  const costUsd = cost?.cost_usd ?? 0;

  return c.json({
    subscriptions: {
      paying: subs?.paying ?? 0,
      comped: subs?.comped ?? 0,
      cancelling: subs?.cancelling ?? 0,
      grace: subs?.grace ?? 0,
    },
    revenue: {
      mrr_usd: Number(mrr.toFixed(2)),
      arr_usd: Number((mrr * 12).toFixed(2)),
      // Apple takes 15% under the Small Business Program, 30% otherwise. Stated
      // at 15% because that is what this account should be enrolled in; if the
      // application has not been approved, this figure is optimistic by 15
      // points and the dashboard says so in the label.
      net_after_apple_usd: Number((mrr * 0.85).toFixed(2)),
      cost_usd: Number(costUsd.toFixed(2)),
      margin_usd: Number((mrr * 0.85 - costUsd).toFixed(2)),
    },
    users: {
      total: users?.total ?? 0,
      new_30d: users?.new_30d ?? 0,
      active_30d: users?.active_30d ?? 0,
    },
    meetings: {
      total: meetings?.total ?? 0,
      last_30d: meetings?.last_30d ?? 0,
      failed_30d: meetings?.failed_30d ?? 0,
      minutes_30d: meetings?.minutes_30d ?? 0,
    },
    usage_this_period: {
      transcription_minutes: cost?.minutes_this_period ?? 0,
    },
  });
});

// ---------------------------------------------------------------------------
// POST /admin/billing/grant — comp a tier to a user
// ---------------------------------------------------------------------------
const GrantRequest = z.object({
  user_id: z.string().uuid(),
  tier: z.enum(["free", "student", "pro", "team"]),
  /** Why. Required — an unexplained entitlement is indistinguishable from a bug. */
  reason: z.string().trim().min(3).max(200),
  /** Optional expiry. Omit for open-ended (a friend testing indefinitely). */
  expires_at: z.string().datetime().nullable().optional(),
});

app.post("/grant", zValidator("json", GrantRequest), async (c) => {
  const { user_id, tier, reason, expires_at } = c.req.valid("json");
  const admin = c.get("user");
  const sql = getSql();

  const [target] = await sql<Array<{ id: string; email: string }>>`
    SELECT id, email FROM users WHERE id = ${user_id}
  `;
  if (!target) {
    return c.json({ error: "not_found", message: "User not found" }, 404);
  }

  /**
   * Refuses to overwrite a real purchase.
   *
   * If someone is paying through Apple, their row carries the store transaction
   * and the renewal date, and stamping 'manual' over it would orphan the
   * subscription: Apple keeps charging, the webhook keeps arriving, and the next
   * RENEWAL silently flips them back. Worse, the revenue query would stop
   * counting a customer who is still paying.
   */
  const [existing] = await sql<Array<{ provider: string; status: string }>>`
    SELECT provider, status FROM subscriptions WHERE user_id = ${user_id}
  `;
  // Only while they are STILL ENTITLED. A row that is expired or refunded has no
  // live Apple subscription behind it — nothing is being charged and no renewal
  // is coming — so comping such a user is safe and is exactly what you would
  // want to do for someone whose payment failed. Blocking on any Apple row at
  // all would make a single past purchase permanently un-comp-able.
  const stillEntitled = ["active", "cancelled", "grace"].includes(existing?.status ?? "");
  if (existing?.provider === "apple" && stillEntitled) {
    return c.json(
      {
        error: "has_paid_subscription",
        message:
          "This user has an active App Store subscription. Granting would be overwritten by their next renewal. Refund or let it lapse first.",
      },
      409,
    );
  }

  await sql`
    INSERT INTO subscriptions (
      user_id, tier, status, provider, billing_interval,
      current_period_start, current_period_end, auto_renew,
      granted_by, granted_reason
    )
    VALUES (
      ${user_id}, ${tier}, 'active', 'manual', 'monthly',
      now(), ${expires_at ?? null}, false,
      ${admin.id}, ${reason}
    )
    ON CONFLICT (user_id) DO UPDATE SET
      tier = EXCLUDED.tier,
      status = 'active',
      provider = 'manual',
      current_period_end = EXCLUDED.current_period_end,
      auto_renew = false,
      granted_by = EXCLUDED.granted_by,
      granted_reason = EXCLUDED.granted_reason
  `;

  console.log("[admin] granted tier", {
    admin: admin.id,
    target: target.email,
    tier,
    reason,
  });

  return c.json({ ok: true, user_id, email: target.email, tier, reason });
});

// ---------------------------------------------------------------------------
// POST /admin/billing/revoke — drop a user back to free
// ---------------------------------------------------------------------------
const RevokeRequest = z.object({
  user_id: z.string().uuid(),
  reason: z.string().trim().min(3).max(200),
});

app.post("/revoke", zValidator("json", RevokeRequest), async (c) => {
  const { user_id, reason } = c.req.valid("json");
  const admin = c.get("user");
  const sql = getSql();

  const [existing] = await sql<Array<{ provider: string }>>`
    SELECT provider FROM subscriptions WHERE user_id = ${user_id}
  `;
  if (!existing) {
    return c.json({ error: "not_found", message: "No subscription row" }, 404);
  }

  /**
   * Revoking an Apple subscription here would be a lie in the database.
   *
   * The user would keep being charged by Apple while the app told them they were
   * on Free. Refunds and cancellations happen on Apple's side and arrive as
   * webhook events; this endpoint governs comped access only.
   */
  if (existing.provider === "apple") {
    return c.json(
      {
        error: "apple_managed",
        message:
          "This subscription is billed by Apple. Revoking here would cut off access while charges continue. Issue a refund in App Store Connect instead — the webhook will downgrade them.",
      },
      409,
    );
  }

  await sql`
    UPDATE subscriptions
    SET tier = 'free',
        status = 'expired',
        auto_renew = false,
        granted_by = ${admin.id},
        granted_reason = ${reason}
    WHERE user_id = ${user_id}
  `;

  // Data is never deleted on downgrade. Retention reverts going forward; what
  // someone already recorded stays theirs.
  console.log("[admin] revoked tier", { admin: admin.id, target: user_id, reason });

  return c.json({ ok: true, user_id, tier: "free", reason });
});

// ---------------------------------------------------------------------------
// GET /admin/billing/subscriptions — every non-free row, for the table
// ---------------------------------------------------------------------------
app.get("/subscriptions", async (c) => {
  const sql = getSql();

  const rows = await sql<
    Array<{
      user_id: string;
      email: string;
      name: string | null;
      tier: string;
      status: string;
      provider: string;
      billing_interval: string | null;
      current_period_end: Date | null;
      auto_renew: boolean;
      granted_reason: string | null;
      granted_by_email: string | null;
    }>
  >`
    SELECT s.user_id,
           u.email,
           u.name,
           s.tier,
           s.status,
           s.provider,
           s.billing_interval,
           s.current_period_end,
           s.auto_renew,
           s.granted_reason,
           g.email AS granted_by_email
    FROM subscriptions s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN users g ON g.id = s.granted_by
    WHERE s.tier != 'free'
    ORDER BY s.provider DESC, u.email ASC
  `;

  return c.json({ subscriptions: rows });
});

export default app;
