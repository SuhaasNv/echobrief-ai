/**
 * /api/v1/webhooks/revenuecat — the only path by which a purchase becomes Pro.
 *
 * This route is PUBLIC. It is mounted before requireAuth because RevenueCat's
 * servers have no session, which makes it the single most dangerous endpoint in
 * the API: it writes `subscriptions.tier`, and `subscriptions.tier` is what the
 * quota middleware enforces. Every guard below exists because its absence is a
 * way to get Pro for free, or to take Pro away from someone who paid.
 *
 *   Authorization      — a shared secret, compared in constant time. Without it
 *                        this is a free-Pro endpoint for anyone who finds the URL.
 *   Fail closed        — no secret configured means every request is refused. An
 *                        unconfigured payments webhook must not be an open one.
 *   Environment        — sandbox receipts must never grant production Pro. Any
 *                        StoreKit tester could otherwise mint entitlements.
 *   Idempotency        — retries are normal; the same event must apply once.
 *   Ordering           — events arrive out of order. A stale EXPIRATION must not
 *                        undo a fresh RENEWAL.
 *
 * The other half of the contract is what this route deliberately does NOT do:
 * a CANCELLATION does not revoke access. The user paid through the end of the
 * period. Cutting them off at cancel time is taking money for nothing, and it
 * generates refund requests and one-star reviews in that order.
 */

import { Hono } from "hono";
import { timingSafeEqual } from "node:crypto";

import { getSql } from "../../db";
import { getEnv } from "../../env";
import type { AppBindings } from "../types";

const app = new Hono<AppBindings>();

/**
 * RevenueCat's event envelope, narrowed to the fields that decide entitlement.
 *
 * Deliberately not a strict Zod schema over the whole payload: RevenueCat adds
 * fields, and a webhook that 400s on an unrecognised key is a webhook that
 * silently stops granting Pro the next time they ship. Validate what is used,
 * ignore the rest.
 */
interface RevenueCatEvent {
  id?: string;
  type?: string;
  app_user_id?: string;
  original_app_user_id?: string;
  product_id?: string;
  period_type?: string;
  environment?: string;
  /** Milliseconds since epoch. */
  event_timestamp_ms?: number;
  expiration_at_ms?: number | null;
  purchased_at_ms?: number | null;
  transaction_id?: string;
  store?: string;
}

/** Events that grant or keep entitlement, and what they mean for the row. */
type Outcome = {
  tier: "free" | "pro";
  status: "active" | "cancelled" | "expired" | "grace" | "refunded";
  autoRenew: boolean;
};

/**
 * The event table.
 *
 * `tier` here is the ENTITLEMENT, not the billing state — which is why
 * CANCELLATION and BILLING_ISSUE both stay on `pro`. Cancellation means "do not
 * bill me again", not "cut me off now", and a billing issue is Apple retrying a
 * card during a grace window in which Apple itself still considers the
 * subscription active.
 */
const OUTCOMES: Record<string, Outcome> = {
  INITIAL_PURCHASE: { tier: "pro", status: "active", autoRenew: true },
  RENEWAL: { tier: "pro", status: "active", autoRenew: true },
  UNCANCELLATION: { tier: "pro", status: "active", autoRenew: true },
  PRODUCT_CHANGE: { tier: "pro", status: "active", autoRenew: true },
  CANCELLATION: { tier: "pro", status: "cancelled", autoRenew: false },
  BILLING_ISSUE: { tier: "pro", status: "grace", autoRenew: true },
  EXPIRATION: { tier: "free", status: "expired", autoRenew: false },
  REFUND: { tier: "free", status: "refunded", autoRenew: false },
};

/**
 * Constant-time secret comparison.
 *
 * `a === b` on a secret leaks its prefix through timing. Lengths are compared
 * first because timingSafeEqual throws on a length mismatch — that comparison is
 * itself non-constant-time, but the length of a shared secret is not the secret.
 */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

app.post("/revenuecat", async (c) => {
  const env = getEnv();
  const secret = env.REVENUECAT_WEBHOOK_SECRET;

  // FAIL CLOSED. An unconfigured secret means this deployment cannot verify
  // anything, so it must not act. Returning 503 rather than 200 also stops
  // RevenueCat marking the delivery successful — it retries, and the events are
  // still there once the secret is set.
  if (!secret) {
    console.error("[revenuecat] refused: REVENUECAT_WEBHOOK_SECRET is not set");
    return c.json({ error: "webhook_not_configured" }, 503);
  }

  const header = c.req.header("authorization") ?? "";
  if (!secretMatches(header, secret)) {
    // No detail in the response, and no echo of what was sent. This is the
    // probe an attacker uses to find out whether the endpoint exists.
    return c.json({ error: "unauthorized" }, 401);
  }

  let payload: { event?: RevenueCatEvent };
  try {
    payload = (await c.req.json()) as { event?: RevenueCatEvent };
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  const event = payload.event;
  if (!event?.type || !event.app_user_id) {
    return c.json({ error: "missing_event_fields" }, 400);
  }

  const outcome = OUTCOMES[event.type];
  if (!outcome) {
    // TRANSFER, SUBSCRIPTION_PAUSED, TEST and anything they add later. 200 on
    // purpose: this is a well-formed, authenticated event that simply does not
    // change entitlement, and 4xx-ing it would make RevenueCat retry forever
    // and eventually disable the webhook.
    return c.json({ ok: true, ignored: event.type });
  }

  /**
   * Sandbox never touches production.
   *
   * Anyone with Xcode can run a StoreKit test and generate a real, correctly
   * signed SANDBOX purchase event. Honouring it in production is free Pro. The
   * check is on the deployment's own environment, so a staging deploy can still
   * accept sandbox events and be genuinely testable.
   */
  const eventEnv = (event.environment ?? "PRODUCTION").toUpperCase();
  const isSandbox = eventEnv === "SANDBOX";
  const serverAcceptsSandbox = env.NODE_ENV !== "production";

  if (isSandbox && !serverAcceptsSandbox) {
    console.warn("[revenuecat] rejected sandbox event in production", {
      type: event.type,
      app_user_id: event.app_user_id,
    });
    // 200, not 4xx: the event is legitimate, it simply does not apply here.
    // Retrying it would change nothing.
    return c.json({ ok: true, ignored: "sandbox_event_in_production" });
  }

  const sql = getSql();

  // The App User ID is the app's own users.id — that is the entire reason
  // Purchases.logIn(user.id) is called on session adopt. Anything else would
  // need a lookup table, and a lookup table is a thing that can be out of date
  // at the exact moment money changes hands.
  const userId = event.app_user_id;
  const [userRow] = await sql<Array<{ id: string }>>`
    SELECT id FROM users WHERE id::text = ${userId} LIMIT 1
  `;

  if (!userRow) {
    // 200 rather than 404. A deleted account still receives expiration events
    // for months, and answering 404 makes RevenueCat retry each one until it
    // disables the webhook for every other user too.
    console.warn("[revenuecat] event for unknown user", { userId, type: event.type });
    return c.json({ ok: true, ignored: "unknown_user" });
  }

  const eventId = event.id ?? null;
  const eventAt = event.event_timestamp_ms ? new Date(event.event_timestamp_ms) : new Date();
  const periodEnd = event.expiration_at_ms ? new Date(event.expiration_at_ms) : null;
  const periodStart = event.purchased_at_ms ? new Date(event.purchased_at_ms) : null;
  const interval = event.product_id?.includes("annual") ? "annual" : "monthly";

  /**
   * Idempotent and order-safe, in one statement.
   *
   * Two separate guards, both in the WHERE of the DO UPDATE so they are decided
   * by the database rather than by a read-then-write that another delivery can
   * interleave with:
   *
   *   `last_event_id IS DISTINCT FROM ${eventId}` — the same event applied
   *   twice is a no-op. Retries are normal, not exceptional.
   *
   *   `last_event_at <= ${eventAt}` — an event older than what has already been
   *   applied is dropped. Without this, a delayed EXPIRATION arriving after a
   *   RENEWAL downgrades a user who has just paid.
   */
  const rows = await sql<Array<{ tier: string; status: string }>>`
    INSERT INTO subscriptions (
      user_id, tier, status, provider, environment, billing_interval,
      current_period_start, current_period_end, auto_renew,
      rc_app_user_id, store_product_id, store_transaction_id,
      last_event_id, last_event_at
    )
    VALUES (
      ${userRow.id}, ${outcome.tier}, ${outcome.status}, 'apple',
      ${isSandbox ? "sandbox" : "production"}, ${interval},
      ${periodStart}, ${periodEnd}, ${outcome.autoRenew},
      ${userId}, ${event.product_id ?? null}, ${event.transaction_id ?? null},
      ${eventId}, ${eventAt}
    )
    ON CONFLICT (user_id) DO UPDATE SET
      tier = EXCLUDED.tier,
      status = EXCLUDED.status,
      provider = 'apple',
      environment = EXCLUDED.environment,
      billing_interval = EXCLUDED.billing_interval,
      current_period_start = COALESCE(EXCLUDED.current_period_start, subscriptions.current_period_start),
      current_period_end = COALESCE(EXCLUDED.current_period_end, subscriptions.current_period_end),
      auto_renew = EXCLUDED.auto_renew,
      rc_app_user_id = EXCLUDED.rc_app_user_id,
      store_product_id = COALESCE(EXCLUDED.store_product_id, subscriptions.store_product_id),
      store_transaction_id = COALESCE(EXCLUDED.store_transaction_id, subscriptions.store_transaction_id),
      last_event_id = EXCLUDED.last_event_id,
      last_event_at = EXCLUDED.last_event_at
    WHERE subscriptions.last_event_id IS DISTINCT FROM ${eventId}
      AND (subscriptions.last_event_at IS NULL OR subscriptions.last_event_at <= ${eventAt})
    RETURNING tier, status
  `;

  // No row back means a guard above declined the write — a duplicate delivery or
  // a late event. Both are successes from RevenueCat's point of view, and saying
  // otherwise would earn a retry storm.
  if (rows.length === 0) {
    return c.json({ ok: true, ignored: "duplicate_or_stale_event" });
  }

  console.log("[revenuecat] applied", {
    type: event.type,
    userId: userRow.id,
    tier: rows[0]?.tier,
    status: rows[0]?.status,
    sandbox: isSandbox,
  });

  return c.json({ ok: true, tier: rows[0]?.tier, status: rows[0]?.status });
});

export default app;
