/**
 * Integration tests for /api/v1/subscription endpoints.
 *
 * Tests subscription fetching, usage tracking, quota limits, and upgrade flows.
 * Reuses users within describe blocks to avoid rate limiting (3 signups/hour/IP).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import api from "@/server/api";
import { getSql } from "@/server/db";

const TEST_PREFIX = `vitest-sub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const createdEmails: string[] = [];

function uniqueEmail(): string {
  const e = `${TEST_PREFIX}-${createdEmails.length}@test.echobrief.local`;
  createdEmails.push(e);
  return e;
}

async function postJson(path: string, body: unknown, token?: string) {
  return api.request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function get(path: string, token?: string) {
  return api.request(path, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
}

async function createUserDirect(
  tier: string = "free",
): Promise<{ email: string; token: string; userId: string }> {
  const email = uniqueEmail();
  const signup = await postJson("/auth/signup", {
    email,
    password: "testpassword12",
    name: "Test User",
  });
  expect(signup.status).toBe(200);
  const { token, user } = await signup.json();

  const sql = getSql();
  await sql`
    INSERT INTO subscriptions (user_id, tier, status)
    VALUES (${user.id}, ${tier}, 'active')
    ON CONFLICT (user_id) DO UPDATE
      SET tier = EXCLUDED.tier, status = 'active'
  `;

  return { email, token, userId: user.id };
}

async function logUsage(
  userId: string,
  workspaceId: string,
  minutes: number,
  queries: number,
  flashcards: number,
) {
  const sql = getSql();
  const period = new Date().toISOString().slice(0, 7); // YYYY-MM

  // Ensure row exists
  await sql`
    INSERT INTO usage_logs (user_id, workspace_id, period)
    VALUES (${userId}, ${workspaceId}, ${period})
    ON CONFLICT (user_id, workspace_id, period) DO NOTHING
  `;

  // Increment the relevant columns
  if (minutes > 0 || queries > 0 || flashcards > 0) {
    await sql`
      UPDATE usage_logs
      SET
        transcription_minutes = transcription_minutes + ${minutes},
        ai_queries_count      = ai_queries_count + ${queries},
        flashcards_generated  = flashcards_generated + ${flashcards},
        updated_at = now()
      WHERE user_id = ${userId} AND workspace_id = ${workspaceId} AND period = ${period}
    `;
  }
}

afterAll(async () => {
  if (createdEmails.length === 0) return;
  const sql = getSql();
  await sql`DELETE FROM users WHERE email = ANY(${sql.array(createdEmails)})`;
});

describe("GET /subscription", () => {
  let freeUser: { token: string; userId: string };
  let studentUser: { token: string; userId: string };
  let proUser: { token: string; userId: string };

  beforeAll(async () => {
    // Create users once for all tests in this block to avoid rate limits
    freeUser = await createUserDirect("free");
    studentUser = await createUserDirect("student");
    proUser = await createUserDirect("pro");
  });

  it("returns 401 when not authenticated", async () => {
    const res = await get("/subscription");
    expect(res.status).toBe(401);
  });

  it("returns free tier with default limits", async () => {
    const res = await get("/subscription", freeUser.token);

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.subscription.tier).toBe("free");
    expect(body.subscription.status).toBe("active");
    expect(body.limits.transcription_minutes).toBe(300);
    expect(body.limits.ai_queries).toBe(10);
    expect(body.features.integrations).toBe(false);
    expect(body.features.history_retention_days).toBe(30);
  });

  it("returns student tier with unlimited limits", async () => {
    const res = await get("/subscription", studentUser.token);

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.subscription.tier).toBe("student");
    expect(body.limits.transcription_minutes).toBeNull();
    expect(body.limits.ai_queries).toBeNull();
    expect(body.features.flashcards).toBe(true);
    expect(body.features.integrations).toBe(false);
    expect(body.features.history_retention_days).toBe(365);
  });

  it("returns pro tier with all features enabled", async () => {
    const res = await get("/subscription", proUser.token);

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.subscription.tier).toBe("pro");
    expect(body.features.integrations).toBe(true);
    expect(body.features.email_generation).toBe(true);
    expect(body.features.history_retention_days).toBe(730);
    expect(body.features.unlimited_history).toBe(false);
  });

  it("includes current usage aggregates", async () => {
    const sql = getSql();
    const [workspace] = await sql<[{ id: string }]>`
      SELECT id FROM workspaces WHERE owner_id = ${freeUser.userId} LIMIT 1
    `;

    await logUsage(freeUser.userId, workspace.id, 150, 5, 2);

    const res = await get("/subscription", freeUser.token);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.usage.transcription_minutes).toBeGreaterThanOrEqual(150);
    expect(body.usage.ai_queries_count).toBeGreaterThanOrEqual(5);
    expect(body.usage.period).toMatch(/^\d{4}-\d{2}$/);
  });

  it("includes workspace count", async () => {
    const res = await get("/subscription", proUser.token);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.usage.workspace_count).toBeGreaterThanOrEqual(1);
  });
});

describe("GET /subscription/pricing", () => {
  let testUser: { token: string };

  beforeAll(async () => {
    testUser = await createUserDirect("free");
  });

  it("returns pricing for all tiers", async () => {
    const res = await get("/subscription/pricing", testUser.token);

    expect(res.status).toBe(200);
    const body = await res.json();

    // Check all tiers present
    expect(body.free).toBeDefined();
    expect(body.student).toBeDefined();
    expect(body.pro).toBeDefined();
    expect(body.team).toBeDefined();

    // Check pricing values
    expect(body.free.price_usd).toBe(0);
    expect(body.student.price_usd).toBe(7);
    expect(body.pro.price_usd).toBe(14);
    expect(body.team.price_usd).toBe(29);
  });

  it("includes features for each tier", async () => {
    const res = await get("/subscription/pricing", testUser.token);
    const body = await res.json();

    expect(body.free.features).toBeDefined();
    expect(body.student.features).toBeDefined();
    expect(body.pro.features).toBeDefined();
    expect(body.team.features).toBeDefined();

    // Verify feature structure
    expect(body.free.features.transcription_minutes).toBe(300);
    expect(body.student.features.transcription_minutes).toBeNull();
    expect(body.pro.features.integrations).toBe(true);
    expect(body.team.features.shared_workspaces).toBe(true);
  });
});

describe("POST /subscription/upgrade", () => {
  let testUser: { token: string; userId: string };

  beforeAll(async () => {
    testUser = await createUserDirect("free");
  });

  it("returns 401 when not authenticated", async () => {
    const res = await postJson("/subscription/upgrade", {
      tier: "pro",
      billing_interval: "monthly",
    });
    expect(res.status).toBe(401);
  });

  it("validates tier enum (only student/pro/team allowed)", async () => {
    const res = await postJson(
      "/subscription/upgrade",
      { tier: "free", billing_interval: "monthly" } as unknown as {
        tier: string;
        billing_interval: string;
      },
      testUser.token,
    );
    expect(res.status).toBe(400);
  });

  it("validates billing_interval enum", async () => {
    const res = await postJson(
      "/subscription/upgrade",
      { tier: "pro", billing_interval: "quarterly" } as unknown as {
        tier: string;
        billing_interval: string;
      },
      testUser.token,
    );
    expect(res.status).toBe(400);
  });

  it("returns placeholder message for upgrade", async () => {
    const res = await postJson(
      "/subscription/upgrade",
      { tier: "pro", billing_interval: "monthly" },
      testUser.token,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toContain("Stripe integration pending");
    expect(body.tier).toBe("pro");
    expect(body.billing_interval).toBe("monthly");
  });
});

describe("POST /subscription/cancel", () => {
  let freeTestUser: { token: string; userId: string };
  let paidTestUser: { token: string; userId: string };

  beforeAll(async () => {
    freeTestUser = await createUserDirect("free");
    paidTestUser = await createUserDirect("pro");
  });

  it("returns 401 when not authenticated", async () => {
    const res = await postJson("/subscription/cancel", {});
    expect(res.status).toBe(401);
  });

  it("returns 400 when user has no paid subscription", async () => {
    const res = await postJson("/subscription/cancel", {}, freeTestUser.token);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toContain("No active subscription to cancel");
  });

  it("cancels paid subscription successfully", async () => {
    const sql = getSql();
    const res = await postJson("/subscription/cancel", {}, paidTestUser.token);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toContain("cancelled successfully");

    const [sub] = await sql<[{ status: string }]>`
      SELECT status FROM subscriptions WHERE user_id = ${paidTestUser.userId}
    `;
    expect(sub.status).toBe("cancelled");
  });
});
