/**
 * Unit tests for usage-tracker.ts service.
 *
 * Tests quota enforcement, usage logging, and tier limit calculations.
 * Each test creates a unique user and cleans up in afterAll.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getSql } from "../../db";
import {
  logTranscription,
  logAIQuery,
  logFlashcardGeneration,
  getCurrentUsage,
  getUserTier,
  checkQuota,
  checkWorkspaceQuota,
  type SubscriptionTier,
} from "../usage-tracker";

const TEST_PREFIX = `vitest-usage-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const testUserIds: string[] = [];
const testWorkspaceIds: string[] = [];

interface TestUser {
  id: string;
  email: string;
  tier: SubscriptionTier;
}

async function createTestUser(tier: SubscriptionTier = "free"): Promise<TestUser> {
  const sql = getSql();
  const email = `${TEST_PREFIX}-${testUserIds.length}@test.echobrief.local`;
  
  // Create user
  const [user] = await sql<[{ id: string }]>`
    INSERT INTO users (email, password_hash, name)
    VALUES (${email}, 'test-hash', 'Test User')
    RETURNING id
  `;
  testUserIds.push(user.id);

  // Create subscription
  await sql`
    INSERT INTO subscriptions (user_id, tier, status)
    VALUES (${user.id}, ${tier}, 'active')
    ON CONFLICT (user_id) DO UPDATE SET tier = ${tier}
  `;

  return { id: user.id, email, tier };
}

async function createTestWorkspace(userId: string): Promise<string> {
  const sql = getSql();
  const [workspace] = await sql<[{ id: string }]>`
    INSERT INTO workspaces (owner_id, name, color)
    VALUES (${userId}, 'Test Workspace', 'brand')
    RETURNING id
  `;
  testWorkspaceIds.push(workspace.id);
  return workspace.id;
}

afterAll(async () => {
  const sql = getSql();
  // Delete cascades to subscriptions, usage_logs, workspaces
  if (testUserIds.length > 0) {
    await sql`DELETE FROM users WHERE id = ANY(${sql.array(testUserIds)})`;
  }
});

describe("logTranscription", () => {
  it("creates a usage_log row with minutes", async () => {
    const user = await createTestUser("free");
    const workspace = await createTestWorkspace(user.id);
    
    await logTranscription(user.id, workspace, 12.5);

    const sql = getSql();
    const [log] = await sql<[{ usage_type: string; amount: number; period: string }]>`
      SELECT usage_type, amount, period
      FROM usage_logs
      WHERE user_id = ${user.id} AND workspace_id = ${workspace}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    expect(log.usage_type).toBe("transcription");
    expect(log.amount).toBe(12.5);
    expect(log.period).toMatch(/^\d{4}-\d{2}$/); // YYYY-MM format
  });

  it("rounds minutes to 2 decimal places", async () => {
    const user = await createTestUser("free");
    const workspace = await createTestWorkspace(user.id);
    
    await logTranscription(user.id, workspace, 12.456789);

    const sql = getSql();
    const [log] = await sql<[{ amount: number }]>`
      SELECT amount
      FROM usage_logs
      WHERE user_id = ${user.id}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    expect(log.amount).toBe(12.46);
  });
});

describe("logAIQuery", () => {
  it("creates a usage_log row for AI query", async () => {
    const user = await createTestUser("free");
    const workspace = await createTestWorkspace(user.id);
    
    await logAIQuery(user.id, workspace);

    const sql = getSql();
    const [log] = await sql<[{ usage_type: string; amount: number }]>`
      SELECT usage_type, amount
      FROM usage_logs
      WHERE user_id = ${user.id} AND workspace_id = ${workspace}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    expect(log.usage_type).toBe("ai_query");
    expect(log.amount).toBe(1);
  });
});

describe("logFlashcardGeneration", () => {
  it("creates a usage_log row with flashcard count", async () => {
    const user = await createTestUser("student");
    const workspace = await createTestWorkspace(user.id);
    
    await logFlashcardGeneration(user.id, workspace, 5);

    const sql = getSql();
    const [log] = await sql<[{ usage_type: string; amount: number }]>`
      SELECT usage_type, amount
      FROM usage_logs
      WHERE user_id = ${user.id} AND workspace_id = ${workspace}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    expect(log.usage_type).toBe("flashcard");
    expect(log.amount).toBe(5);
  });
});

describe("getCurrentUsage", () => {
  it("aggregates usage for current month", async () => {
    const user = await createTestUser("free");
    const workspace = await createTestWorkspace(user.id);
    
    // Log some usage
    await logTranscription(user.id, workspace, 100);
    await logTranscription(user.id, workspace, 50);
    await logAIQuery(user.id, workspace);
    await logAIQuery(user.id, workspace);
    await logFlashcardGeneration(user.id, workspace, 2);

    const usage = await getCurrentUsage(user.id);

    expect(usage.transcription_minutes).toBe(150);
    expect(usage.ai_queries).toBe(2);
    expect(usage.flashcards).toBe(2);
  });

  it("returns zeros when no usage exists", async () => {
    const user = await createTestUser("free");
    
    const usage = await getCurrentUsage(user.id);

    expect(usage.transcription_minutes).toBe(0);
    expect(usage.ai_queries).toBe(0);
    expect(usage.flashcards).toBe(0);
  });

  it("filters by workspace when workspaceId provided", async () => {
    const user = await createTestUser("free");
    const workspace1 = await createTestWorkspace(user.id);
    const workspace2 = await createTestWorkspace(user.id);
    
    await logTranscription(user.id, workspace1, 100);
    await logTranscription(user.id, workspace2, 50);

    const usage1 = await getCurrentUsage(user.id, workspace1);
    const usage2 = await getCurrentUsage(user.id, workspace2);

    expect(usage1.transcription_minutes).toBe(100);
    expect(usage2.transcription_minutes).toBe(50);
  });

  it("only counts current month usage (YYYY-MM rollup)", async () => {
    const user = await createTestUser("free");
    const workspace = await createTestWorkspace(user.id);
    const sql = getSql();

    // Insert usage from previous month
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    const lastMonthPeriod = lastMonth.toISOString().slice(0, 7);

    await sql`
      INSERT INTO usage_logs (user_id, workspace_id, usage_type, amount, period)
      VALUES (${user.id}, ${workspace}, 'transcription', 999, ${lastMonthPeriod})
    `;

    // Insert current month usage
    await logTranscription(user.id, workspace, 100);

    const usage = await getCurrentUsage(user.id);

    // Should only count current month
    expect(usage.transcription_minutes).toBe(100);
  });
});

describe("getUserTier", () => {
  it("returns correct tier from subscriptions table", async () => {
    const user1 = await createTestUser("free");
    const user2 = await createTestUser("pro");
    const user3 = await createTestUser("team");

    expect(await getUserTier(user1.id)).toBe("free");
    expect(await getUserTier(user2.id)).toBe("pro");
    expect(await getUserTier(user3.id)).toBe("team");
  });

  it("defaults to free when no subscription exists", async () => {
    const sql = getSql();
    const [user] = await sql<[{ id: string }]>`
      INSERT INTO users (email, password_hash, name)
      VALUES ('no-sub@test.local', 'hash', 'No Sub User')
      RETURNING id
    `;
    testUserIds.push(user.id);

    const tier = await getUserTier(user.id);
    expect(tier).toBe("free");
  });
});

describe("checkQuota - transcription", () => {
  it("allows transcription when under limit", async () => {
    const user = await createTestUser("free");
    const workspace = await createTestWorkspace(user.id);

    // Log 100 minutes (well under 300 limit)
    await logTranscription(user.id, workspace, 100);

    const result = await checkQuota(user.id, "transcription");

    expect(result.allowed).toBe(true);
    expect(result.current).toBe(100);
    expect(result.limit).toBe(300);
  });

  it("denies transcription when at limit", async () => {
    const user = await createTestUser("free");
    const workspace = await createTestWorkspace(user.id);

    // Log exactly 300 minutes (at limit)
    await logTranscription(user.id, workspace, 300);

    const result = await checkQuota(user.id, "transcription");

    expect(result.allowed).toBe(false);
    expect(result.current).toBe(300);
    expect(result.limit).toBe(300);
  });

  it("denies transcription when over limit", async () => {
    const user = await createTestUser("free");
    const workspace = await createTestWorkspace(user.id);

    await logTranscription(user.id, workspace, 350);

    const result = await checkQuota(user.id, "transcription");

    expect(result.allowed).toBe(false);
    expect(result.current).toBe(350);
  });

  it("allows unlimited transcription for paid tiers", async () => {
    const student = await createTestUser("student");
    const pro = await createTestUser("pro");
    const team = await createTestUser("team");

    const workspace1 = await createTestWorkspace(student.id);
    const workspace2 = await createTestWorkspace(pro.id);
    const workspace3 = await createTestWorkspace(team.id);

    // Log massive amounts
    await logTranscription(student.id, workspace1, 10000);
    await logTranscription(pro.id, workspace2, 10000);
    await logTranscription(team.id, workspace3, 10000);

    expect((await checkQuota(student.id, "transcription")).allowed).toBe(true);
    expect((await checkQuota(pro.id, "transcription")).allowed).toBe(true);
    expect((await checkQuota(team.id, "transcription")).allowed).toBe(true);

    // Verify limit is null (unlimited)
    expect((await checkQuota(student.id, "transcription")).limit).toBeNull();
    expect((await checkQuota(pro.id, "transcription")).limit).toBeNull();
  });
});

describe("checkQuota - ai_query", () => {
  it("denies AI queries when free tier at 10 queries", async () => {
    const user = await createTestUser("free");
    const workspace = await createTestWorkspace(user.id);

    // Log 10 queries (at limit)
    for (let i = 0; i < 10; i++) {
      await logAIQuery(user.id, workspace);
    }

    const result = await checkQuota(user.id, "ai_query");

    expect(result.allowed).toBe(false);
    expect(result.current).toBe(10);
    expect(result.limit).toBe(10);
  });

  it("allows unlimited AI queries for paid tiers", async () => {
    const student = await createTestUser("student");
    const workspace = await createTestWorkspace(student.id);

    for (let i = 0; i < 100; i++) {
      await logAIQuery(student.id, workspace);
    }

    const result = await checkQuota(student.id, "ai_query");

    expect(result.allowed).toBe(true);
    expect(result.current).toBe(100);
    expect(result.limit).toBeNull();
  });
});

describe("checkQuota - flashcard", () => {
  it("denies flashcard generation when free tier at 3 flashcards", async () => {
    const user = await createTestUser("free");
    const workspace = await createTestWorkspace(user.id);

    await logFlashcardGeneration(user.id, workspace, 3);

    const result = await checkQuota(user.id, "flashcard");

    expect(result.allowed).toBe(false);
    expect(result.current).toBe(3);
    expect(result.limit).toBe(3);
  });

  it("allows unlimited flashcards for student+ tiers", async () => {
    const student = await createTestUser("student");
    const workspace = await createTestWorkspace(student.id);

    await logFlashcardGeneration(student.id, workspace, 1000);

    const result = await checkQuota(student.id, "flashcard");

    expect(result.allowed).toBe(true);
    expect(result.limit).toBeNull();
  });
});

describe("checkWorkspaceQuota", () => {
  it("denies workspace creation when free tier at 1 workspace", async () => {
    const user = await createTestUser("free");
    await createTestWorkspace(user.id); // Create 1 workspace

    const result = await checkWorkspaceQuota(user.id);

    expect(result.allowed).toBe(false);
    expect(result.current).toBe(1);
    expect(result.limit).toBe(1);
  });

  it("allows workspace creation when free tier at 0 workspaces", async () => {
    const user = await createTestUser("free");

    const result = await checkWorkspaceQuota(user.id);

    expect(result.allowed).toBe(true);
    expect(result.current).toBe(0);
    expect(result.limit).toBe(1);
  });

  it("allows unlimited workspaces for paid tiers", async () => {
    const pro = await createTestUser("pro");

    // Create 10 workspaces
    for (let i = 0; i < 10; i++) {
      await createTestWorkspace(pro.id);
    }

    const result = await checkWorkspaceQuota(pro.id);

    expect(result.allowed).toBe(true);
    expect(result.current).toBe(10);
    expect(result.limit).toBeNull();
  });
});
