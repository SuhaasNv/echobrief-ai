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
  // Cast to uuid[] to avoid the "operator does not exist: uuid = text" error
  if (testUserIds.length > 0) {
    await sql`DELETE FROM users WHERE id = ANY(${sql.array(testUserIds)}::uuid[])`;
  }
});

describe("logTranscription", () => {
  it("creates a usage_log row with minutes", async () => {
    const user = await createTestUser("free");
    const workspace = await createTestWorkspace(user.id);

    await logTranscription(user.id, workspace, 750); // 750 seconds = 13 min (ceil)

    const sql = getSql();
    const [log] = await sql<[{ transcription_minutes: number; period: string }]>`
      SELECT transcription_minutes, period
      FROM usage_logs
      WHERE user_id = ${user.id} AND workspace_id = ${workspace}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    expect(log.transcription_minutes).toBeGreaterThan(0);
    expect(log.period).toMatch(/^\d{4}-\d{2}$/); // YYYY-MM format
  });

  it("rounds minutes to 2 decimal places", async () => {
    const user = await createTestUser("free");
    const workspace = await createTestWorkspace(user.id);

    await logTranscription(user.id, workspace, 12456); // seconds; minutes = ceil(12456/60) = 208

    const sql = getSql();
    const [log] = await sql<[{ transcription_minutes: number }]>`
      SELECT transcription_minutes
      FROM usage_logs
      WHERE user_id = ${user.id}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    // logTranscription uses Math.ceil(durationSec / 60)
    expect(log.transcription_minutes).toBe(Math.ceil(12456 / 60));
  });
});

describe("logAIQuery", () => {
  it("creates a usage_log row for AI query", async () => {
    const user = await createTestUser("free");
    const workspace = await createTestWorkspace(user.id);

    await logAIQuery(user.id, workspace);

    const sql = getSql();
    const [log] = await sql<[{ ai_queries_count: number }]>`
      SELECT ai_queries_count
      FROM usage_logs
      WHERE user_id = ${user.id} AND workspace_id = ${workspace}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    expect(log.ai_queries_count).toBe(1);
  });
});

describe("logFlashcardGeneration", () => {
  it("creates a usage_log row with flashcard count", async () => {
    const user = await createTestUser("student");
    const workspace = await createTestWorkspace(user.id);

    await logFlashcardGeneration(user.id, workspace, 5);

    const sql = getSql();
    const [log] = await sql<[{ flashcards_generated: number }]>`
      SELECT flashcards_generated
      FROM usage_logs
      WHERE user_id = ${user.id} AND workspace_id = ${workspace}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    expect(log.flashcards_generated).toBe(5);
  });
});

describe("getCurrentUsage", () => {
  it("aggregates usage for current month", async () => {
    const user = await createTestUser("free");
    const workspace = await createTestWorkspace(user.id);

    // Log some usage — logTranscription takes durationSec, convert minutes→seconds
    await logTranscription(user.id, workspace, 9000); // 9000s = 150 min
    await logTranscription(user.id, workspace, 0); // add-on: use two separate calls
    await logAIQuery(user.id, workspace);
    await logAIQuery(user.id, workspace);
    await logFlashcardGeneration(user.id, workspace, 2);

    const usage = await getCurrentUsage(user.id);

    expect(usage.transcription_minutes).toBe(150);
    expect(usage.ai_queries_count).toBe(2);
    expect(usage.flashcards_generated).toBe(2);
  });

  it("returns zeros when no usage exists", async () => {
    const user = await createTestUser("free");

    const usage = await getCurrentUsage(user.id);

    expect(usage.transcription_minutes).toBe(0);
    expect(usage.ai_queries_count).toBe(0);
    expect(usage.flashcards_generated).toBe(0);
  });

  it("filters by workspace when workspaceId provided", async () => {
    const user = await createTestUser("free");
    const workspace1 = await createTestWorkspace(user.id);
    const workspace2 = await createTestWorkspace(user.id);

    // logTranscription takes durationSec: 6000s=100min, 3000s=50min
    await logTranscription(user.id, workspace1, 6000);
    await logTranscription(user.id, workspace2, 3000);

    const usage1 = await getCurrentUsage(user.id, workspace1);
    const usage2 = await getCurrentUsage(user.id, workspace2);

    expect(usage1.transcription_minutes).toBe(100);
    expect(usage2.transcription_minutes).toBe(50);
  });

  it("only counts current month usage (YYYY-MM rollup)", async () => {
    const user = await createTestUser("free");
    const workspace = await createTestWorkspace(user.id);
    const sql = getSql();

    // Insert usage from previous month via direct SQL using real schema columns
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    const lastMonthPeriod = lastMonth.toISOString().slice(0, 7);

    await sql`
      INSERT INTO usage_logs (user_id, workspace_id, transcription_minutes, period)
      VALUES (${user.id}, ${workspace}, 999, ${lastMonthPeriod})
      ON CONFLICT (user_id, workspace_id, period) DO UPDATE
        SET transcription_minutes = usage_logs.transcription_minutes + 999
    `;

    // Insert current month usage: 6000s = 100 min
    await logTranscription(user.id, workspace, 6000);

    const usage = await getCurrentUsage(user.id);

    // Should only count current month (100 min)
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

    // Log 100 minutes (well under 300 limit) — durationSec = 100 * 60
    await logTranscription(user.id, workspace, 6000);

    const result = await checkQuota(user.id, "transcription");

    expect(result.allowed).toBe(true);
    expect(result.current).toBe(100);
    expect(result.limit).toBe(120);
  });

  it("denies transcription when at limit", async () => {
    const user = await createTestUser("free");
    const workspace = await createTestWorkspace(user.id);

    // Log exactly 120 minutes (at limit) — durationSec = 120 * 60 = 7200
    await logTranscription(user.id, workspace, 7200);

    const result = await checkQuota(user.id, "transcription");

    expect(result.allowed).toBe(false);
    expect(result.current).toBe(120);
    expect(result.limit).toBe(120);
  });

  it("denies transcription when over limit", async () => {
    const user = await createTestUser("free");
    const workspace = await createTestWorkspace(user.id);

    // 350 minutes = 21000 seconds
    await logTranscription(user.id, workspace, 21000);

    const result = await checkQuota(user.id, "transcription");

    expect(result.allowed).toBe(false);
    expect(result.current).toBe(350);
  });

  /**
   * Pro is generous, not infinite.
   *
   * The old version logged 10,000 minutes and asserted `limit` was null for
   * every paid tier. Pro now carries a 900-minute fair-use ceiling, so that
   * assertion described a product decision that has been reversed. What matters
   * is that Pro clears usage which would stop a free account many times over —
   * and that going past the ceiling is refused rather than silently unmetered.
   */
  it("allows pro far past the free ceiling, and stops at its own", async () => {
    const pro = await createTestUser("pro");
    const workspace = await createTestWorkspace(pro.id);

    // 500 minutes: over four times the free allowance, inside pro's 900.
    await logTranscription(pro.id, workspace, 500 * 60);
    expect((await checkQuota(pro.id, "transcription")).allowed).toBe(true);

    // Past 900 it is refused, the same as any other limit.
    await logTranscription(pro.id, workspace, 450 * 60);
    const over = await checkQuota(pro.id, "transcription");
    expect(over.allowed).toBe(false);
    if (!over.allowed) {
      expect(over.limit).toBe(900);
      // And the copy must NOT tell a Pro user to upgrade — there is nowhere to go.
      expect(over.reason).toMatch(/fair-use/i);
      expect(over.reason).not.toMatch(/upgrade/i);
    }
  });

  // student and team are hidden from sale but still resolve to real limits, so
  // an account already on one keeps working rather than falling through to
  // undefined.
  it("still resolves hidden tiers to unlimited", async () => {
    const student = await createTestUser("student");
    const workspace = await createTestWorkspace(student.id);
    await logTranscription(student.id, workspace, 600000);

    const result = await checkQuota(student.id, "transcription");
    expect(result.allowed).toBe(true);
    expect(result.limit).toBeNull();
  });
});

describe("checkQuota - ai_query", () => {
  it("denies AI queries when free tier at 25 queries", async () => {
    const user = await createTestUser("free");
    const workspace = await createTestWorkspace(user.id);

    // Log 25 queries (at limit)
    for (let i = 0; i < 25; i++) {
      await logAIQuery(user.id, workspace);
    }

    const result = await checkQuota(user.id, "ai_query");

    expect(result.allowed).toBe(false);
    expect(result.current).toBe(25);
    expect(result.limit).toBe(25);
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
