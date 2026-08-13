/**
 * Integration tests for quota enforcement middleware.
 *
 * Tests that quota middleware correctly blocks requests when limits are exceeded
 * and allows requests when quota is available.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import { getSql } from "@/server/db";
import {
  requireTranscriptionQuota,
  requireAIQueryQuota,
  requireFlashcardQuota,
} from "@/server/api/middleware/quota";
import { requireAuth } from "@/server/api/middleware/auth";
import type { AppBindings } from "@/server/api/types";
import api from "@/server/api";

const TEST_PREFIX = `vitest-quota-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
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

async function createUserWithTier(
  tier: string,
): Promise<{ token: string; userId: string; workspaceId: string }> {
  const email = uniqueEmail();
  const signup = await postJson("/auth/signup", {
    email,
    password: "testpassword12",
    name: "Quota Test User",
  });
  expect(signup.status).toBe(200);
  const { token, user } = await signup.json();

  const sql = getSql();

  // Set tier (always UPSERT to ensure active row exists)
  await sql`
    INSERT INTO subscriptions (user_id, tier, status)
    VALUES (${user.id}, ${tier}, 'active')
    ON CONFLICT (user_id) DO UPDATE
      SET tier = EXCLUDED.tier, status = 'active'
  `;

  // Get workspace
  const [workspace] = await sql<[{ id: string }]>`
    SELECT id FROM workspaces WHERE owner_id = ${user.id} LIMIT 1
  `;

  return { token, userId: user.id, workspaceId: workspace.id };
}

async function logUsageDirectly(userId: string, workspaceId: string, type: string, amount: number) {
  const sql = getSql();
  const period = new Date().toISOString().slice(0, 7);

  // Map type to the actual columnar schema column names
  const colMap: Record<string, string> = {
    transcription: "transcription_minutes",
    ai_query: "ai_queries_count",
    flashcard: "flashcards_generated",
  };
  const col = colMap[type];
  if (!col) throw new Error(`Unknown usage type: ${type}`);

  // Ensure the row exists first, then increment the right column
  await sql`
    INSERT INTO usage_logs (user_id, workspace_id, period)
    VALUES (${userId}, ${workspaceId}, ${period})
    ON CONFLICT (user_id, workspace_id, period) DO NOTHING
  `;

  // Use dynamic SQL to increment the correct column
  if (col === "transcription_minutes") {
    await sql`
      UPDATE usage_logs
      SET transcription_minutes = transcription_minutes + ${amount}, updated_at = now()
      WHERE user_id = ${userId} AND workspace_id = ${workspaceId} AND period = ${period}
    `;
  } else if (col === "ai_queries_count") {
    await sql`
      UPDATE usage_logs
      SET ai_queries_count = ai_queries_count + ${amount}, updated_at = now()
      WHERE user_id = ${userId} AND workspace_id = ${workspaceId} AND period = ${period}
    `;
  } else if (col === "flashcards_generated") {
    await sql`
      UPDATE usage_logs
      SET flashcards_generated = flashcards_generated + ${amount}, updated_at = now()
      WHERE user_id = ${userId} AND workspace_id = ${workspaceId} AND period = ${period}
    `;
  }
}

afterAll(async () => {
  if (createdEmails.length === 0) return;
  const sql = getSql();
  await sql`DELETE FROM users WHERE email = ANY(${sql.array(createdEmails)})`;
});

import type { MiddlewareHandler } from "hono";

// Create test app with quota middleware
function createTestApp(middleware: MiddlewareHandler<AppBindings>) {
  const app = new Hono<AppBindings>();
  app.use("*", requireAuth); // Auth required first
  app.post("/test", middleware, async (c) => {
    return c.json({ success: true });
  });
  return app;
}

describe("requireTranscriptionQuota middleware", () => {
  let freeUser: { token: string; userId: string; workspaceId: string };
  let proUser: { token: string; userId: string; workspaceId: string };

  beforeAll(async () => {
    freeUser = await createUserWithTier("free");
    proUser = await createUserWithTier("pro");
  });

  it("allows transcription when free tier under limit (< 120 min)", async () => {
    const app = createTestApp(requireTranscriptionQuota);

    // Log 100 minutes (under the 120 limit)
    await logUsageDirectly(freeUser.userId, freeUser.workspaceId, "transcription", 100);

    const res = await app.request("/test", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${freeUser.token}`,
      },
      body: JSON.stringify({ duration_sec: 60 }), // 1 minute
    });

    expect(res.status).toBe(200);
  });

  it("blocks transcription when free tier at limit (120 min)", async () => {
    const testUser = await createUserWithTier("free");
    const app = createTestApp(requireTranscriptionQuota);

    // Log exactly 120 minutes
    await logUsageDirectly(testUser.userId, testUser.workspaceId, "transcription", 120);

    const res = await app.request("/test", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${testUser.token}`,
      },
      body: JSON.stringify({ duration_sec: 60 }),
    });

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("quota_exceeded");
    expect(body.tier).toBe("free");
    expect(body.current).toBe(120);
    expect(body.limit).toBe(120);
  });

  it("blocks transcription when free tier over limit", async () => {
    const testUser = await createUserWithTier("free");
    const app = createTestApp(requireTranscriptionQuota);

    // Log 350 minutes (over limit)
    await logUsageDirectly(testUser.userId, testUser.workspaceId, "transcription", 350);

    const res = await app.request("/test", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${testUser.token}`,
      },
      body: JSON.stringify({ duration_sec: 60 }),
    });

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.current).toBeGreaterThanOrEqual(350);
  });

  it("allows pro tier well past the free ceiling", async () => {
    const app = createTestApp(requireTranscriptionQuota);

    // 500 minutes: four times the free allowance, comfortably inside pro's 900.
    // Pro is no longer unlimited, so this asserts headroom rather than absence
    // of a limit — 1000 would now legitimately be refused.
    await logUsageDirectly(proUser.userId, proUser.workspaceId, "transcription", 500);

    const res = await app.request("/test", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${proUser.token}`,
      },
      body: JSON.stringify({ duration_sec: 60 }),
    });

    expect(res.status).toBe(200);
  });

  it("calculates minutes from duration_sec correctly", async () => {
    const testUser = await createUserWithTier("free");
    const app = createTestApp(requireTranscriptionQuota);

    // Log 119 minutes
    await logUsageDirectly(testUser.userId, testUser.workspaceId, "transcription", 119);

    // Request 90 seconds (2 minutes after ceiling)
    const res = await app.request("/test", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${testUser.token}`,
      },
      body: JSON.stringify({ duration_sec: 90 }), // 1.5 min → ceil to 2
    });

    // 119 + 2 = 121, exceeds the 120 limit
    expect(res.status).toBe(429);
  });
});

describe("requireAIQueryQuota middleware", () => {
  let freeUser: { token: string; userId: string; workspaceId: string };
  let studentUser: { token: string; userId: string; workspaceId: string };

  beforeAll(async () => {
    freeUser = await createUserWithTier("free");
    studentUser = await createUserWithTier("student");
  });

  it("allows AI query when free tier under limit (< 25 queries)", async () => {
    const app = createTestApp(requireAIQueryQuota);

    // Log 5 queries
    for (let i = 0; i < 5; i++) {
      await logUsageDirectly(freeUser.userId, freeUser.workspaceId, "ai_query", 1);
    }

    const res = await app.request("/test", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${freeUser.token}`,
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
  });

  it("blocks AI query when free tier at limit (25 queries)", async () => {
    const testUser = await createUserWithTier("free");
    const app = createTestApp(requireAIQueryQuota);

    // Log exactly 25 queries
    for (let i = 0; i < 25; i++) {
      await logUsageDirectly(testUser.userId, testUser.workspaceId, "ai_query", 1);
    }

    const res = await app.request("/test", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${testUser.token}`,
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("quota_exceeded");
    expect(body.current).toBe(25);
    expect(body.limit).toBe(25);
  });

  it("allows AI query for student tier with unlimited quota", async () => {
    const app = createTestApp(requireAIQueryQuota);

    // Log 100 queries (would exceed free tier)
    for (let i = 0; i < 100; i++) {
      await logUsageDirectly(studentUser.userId, studentUser.workspaceId, "ai_query", 1);
    }

    const res = await app.request("/test", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${studentUser.token}`,
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
  });
});

describe("requireFlashcardQuota middleware", () => {
  let freeUser: { token: string; userId: string; workspaceId: string };
  let studentUser: { token: string; userId: string; workspaceId: string };

  beforeAll(async () => {
    freeUser = await createUserWithTier("free");
    studentUser = await createUserWithTier("student");
  });

  it("allows flashcard generation when free tier under limit (< 3)", async () => {
    const app = createTestApp(requireFlashcardQuota);

    // Log 1 flashcard
    await logUsageDirectly(freeUser.userId, freeUser.workspaceId, "flashcard", 1);

    const res = await app.request("/test", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${freeUser.token}`,
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
  });

  it("blocks flashcard generation when free tier at limit (3)", async () => {
    const testUser = await createUserWithTier("free");
    const app = createTestApp(requireFlashcardQuota);

    // Log exactly 3 flashcards
    await logUsageDirectly(testUser.userId, testUser.workspaceId, "flashcard", 3);

    const res = await app.request("/test", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${testUser.token}`,
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("quota_exceeded");
    expect(body.current).toBe(3);
    expect(body.limit).toBe(3);
  });

  it("allows flashcard generation for student tier with unlimited quota", async () => {
    const app = createTestApp(requireFlashcardQuota);

    // Log 50 flashcards (would exceed free tier)
    await logUsageDirectly(studentUser.userId, studentUser.workspaceId, "flashcard", 50);

    const res = await app.request("/test", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${studentUser.token}`,
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
  });
});

describe("quota middleware error responses", () => {
  let testUser: { token: string; userId: string; workspaceId: string };

  beforeAll(async () => {
    testUser = await createUserWithTier("free");
  });

  it("returns correct error structure on quota exceeded", async () => {
    const app = createTestApp(requireAIQueryQuota);

    // Exceed AI query limit
    for (let i = 0; i < 25; i++) {
      await logUsageDirectly(testUser.userId, testUser.workspaceId, "ai_query", 1);
    }

    const res = await app.request("/test", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${testUser.token}`,
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(429);
    expect(res.headers.get("content-type")).toContain("application/json");

    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(body).toHaveProperty("message");
    expect(body).toHaveProperty("tier");
    expect(body).toHaveProperty("current");
    expect(body).toHaveProperty("limit");

    expect(body.message.toLowerCase()).toContain("upgrade"); // Should suggest upgrading
  });

  it("includes upgrade suggestion in error message", async () => {
    const app = createTestApp(requireTranscriptionQuota);

    await logUsageDirectly(testUser.userId, testUser.workspaceId, "transcription", 120);

    const res = await app.request("/test", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${testUser.token}`,
      },
      body: JSON.stringify({ duration_sec: 60 }),
    });

    const body = await res.json();
    expect(body.message.toLowerCase()).toMatch(/upgrade|limit/);
  });
});
