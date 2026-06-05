/**
 * Usage tracking service.
 *
 * Centralized logging and quota checking for subscription tiers. All usage
 * metrics (transcription minutes, AI queries, flashcard generation) flow
 * through this service, which writes to the usage_logs table and enforces
 * tier-based limits.
 *
 * Usage:
 *   await logTranscription(userId, workspaceId, durationSec, costUsd);
 *   await logAIQuery(userId, workspaceId, costUsd);
 *   const status = await checkQuota(userId, 'transcription', minutes);
 */

import { getSql, type Sql } from "../db";

export type SubscriptionTier = "free" | "student" | "pro" | "team";
export type UsageType = "transcription" | "ai_query" | "flashcard";

interface TierLimits {
  transcription_minutes: number | null; // null = unlimited
  ai_queries: number | null;
  flashcards_per_lecture: number | null;
  workspaces: number | null;
}

const TIER_LIMITS: Record<SubscriptionTier, TierLimits> = {
  free: {
    transcription_minutes: 300, // 5 hours
    ai_queries: 10,
    flashcards_per_lecture: 3,
    workspaces: 1,
  },
  student: {
    transcription_minutes: null, // unlimited
    ai_queries: null,
    flashcards_per_lecture: null,
    workspaces: null,
  },
  pro: {
    transcription_minutes: null,
    ai_queries: null,
    flashcards_per_lecture: null,
    workspaces: null,
  },
  team: {
    transcription_minutes: null,
    ai_queries: null,
    flashcards_per_lecture: null,
    workspaces: null,
  },
};

/**
 * Get the current period in YYYY-MM format (e.g., "2026-05").
 */
function getCurrentPeriod(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Get or create usage log row for the current period.
 */
async function ensureUsageLog(
  sql: Sql,
  userId: string,
  workspaceId: string | null,
  period: string,
): Promise<void> {
  await sql`
    INSERT INTO usage_logs (user_id, workspace_id, period)
    VALUES (${userId}, ${workspaceId}, ${period})
    ON CONFLICT (user_id, workspace_id, period) DO NOTHING
  `;
}

/**
 * Log transcription usage (duration in seconds).
 */
export async function logTranscription(
  userId: string,
  workspaceId: string | null,
  durationSec: number,
  costUsd: number = 0,
): Promise<void> {
  const sql = getSql();
  const period = getCurrentPeriod();
  const minutes = Math.ceil(durationSec / 60);

  await ensureUsageLog(sql, userId, workspaceId, period);

  await sql`
    UPDATE usage_logs
    SET 
      transcription_minutes = transcription_minutes + ${minutes},
      total_cost_usd = total_cost_usd + ${costUsd},
      updated_at = now()
    WHERE user_id = ${userId} 
      AND workspace_id IS NOT DISTINCT FROM ${workspaceId}
      AND period = ${period}
  `;
}

/**
 * Log AI query usage (chat, search, email generation).
 */
export async function logAIQuery(
  userId: string,
  workspaceId: string | null,
  costUsd: number = 0,
): Promise<void> {
  const sql = getSql();
  const period = getCurrentPeriod();

  await ensureUsageLog(sql, userId, workspaceId, period);

  await sql`
    UPDATE usage_logs
    SET 
      ai_queries_count = ai_queries_count + 1,
      total_cost_usd = total_cost_usd + ${costUsd},
      updated_at = now()
    WHERE user_id = ${userId} 
      AND workspace_id IS NOT DISTINCT FROM ${workspaceId}
      AND period = ${period}
  `;
}

/**
 * Log flashcard generation usage.
 */
export async function logFlashcardGeneration(
  userId: string,
  workspaceId: string | null,
  count: number,
  costUsd: number = 0,
): Promise<void> {
  const sql = getSql();
  const period = getCurrentPeriod();

  await ensureUsageLog(sql, userId, workspaceId, period);

  await sql`
    UPDATE usage_logs
    SET 
      flashcards_generated = flashcards_generated + ${count},
      total_cost_usd = total_cost_usd + ${costUsd},
      updated_at = now()
    WHERE user_id = ${userId} 
      AND workspace_id IS NOT DISTINCT FROM ${workspaceId}
      AND period = ${period}
  `;
}

/**
 * Get current usage for a user in the current period.
 */
export async function getCurrentUsage(
  userId: string,
  workspaceId: string | null = null,
): Promise<{
  transcription_minutes: number;
  ai_queries_count: number;
  flashcards_generated: number;
  total_cost_usd: number;
  period: string;
}> {
  const sql = getSql();
  const period = getCurrentPeriod();

  // If workspace_id is provided, get usage for that workspace only.
  // Otherwise, aggregate across all workspaces.
  const rows = workspaceId
    ? await sql<
        Array<{
          transcription_minutes: number;
          ai_queries_count: number;
          flashcards_generated: number;
          total_cost_usd: number;
        }>
      >`
        SELECT 
          transcription_minutes,
          ai_queries_count,
          flashcards_generated,
          total_cost_usd
        FROM usage_logs
        WHERE user_id = ${userId} 
          AND workspace_id = ${workspaceId}
          AND period = ${period}
      `
    : await sql<
        Array<{
          transcription_minutes: number;
          ai_queries_count: number;
          flashcards_generated: number;
          total_cost_usd: number;
        }>
      >`
        SELECT 
          COALESCE(SUM(transcription_minutes), 0)::int AS transcription_minutes,
          COALESCE(SUM(ai_queries_count), 0)::int AS ai_queries_count,
          COALESCE(SUM(flashcards_generated), 0)::int AS flashcards_generated,
          COALESCE(SUM(total_cost_usd), 0) AS total_cost_usd
        FROM usage_logs
        WHERE user_id = ${userId} AND period = ${period}
      `;

  if (rows.length === 0) {
    return {
      transcription_minutes: 0,
      ai_queries_count: 0,
      flashcards_generated: 0,
      total_cost_usd: 0,
      period,
    };
  }

  return { ...rows[0], period };
}

/**
 * Get user's subscription tier.
 */
export async function getUserTier(userId: string): Promise<SubscriptionTier> {
  const sql = getSql();
  const rows = await sql<Array<{ tier: SubscriptionTier }>>`
    SELECT tier FROM subscriptions 
    WHERE user_id = ${userId} AND status = 'active'
    LIMIT 1
  `;
  return rows[0]?.tier ?? "free";
}

/**
 * Check if a user has quota remaining for a given usage type.
 *
 * Returns { allowed: true } if within quota, or { allowed: false, reason, ... }
 * if quota is exceeded.
 */
export async function checkQuota(
  userId: string,
  usageType: UsageType,
  amount: number = 1,
  workspaceId: string | null = null,
): Promise<
  | { allowed: true; current: number; limit: number | null }
  | {
      allowed: false;
      tier: SubscriptionTier;
      current: number;
      limit: number;
      reason: string;
    }
> {
  const tier = await getUserTier(userId);
  const limits = TIER_LIMITS[tier];
  const usage = await getCurrentUsage(userId, workspaceId);

  let current = 0;
  let limit = 0;

  switch (usageType) {
    case "transcription":
      current = usage.transcription_minutes;
      limit = limits.transcription_minutes ?? Infinity;
      if (limits.transcription_minutes !== null && current + amount > limit) {
        return {
          allowed: false,
          tier,
          current,
          limit,
          reason: `You've used ${current} of ${limit} transcription minutes this month. Upgrade for unlimited.`,
        };
      }
      break;

    case "ai_query":
      current = usage.ai_queries_count;
      limit = limits.ai_queries ?? Infinity;
      if (limits.ai_queries !== null && current + amount > limit) {
        return {
          allowed: false,
          tier,
          current,
          limit,
          reason: `You've used ${current} of ${limit} AI queries this month. Upgrade for unlimited.`,
        };
      }
      break;

    case "flashcard":
      current = usage.flashcards_generated;
      limit = limits.flashcards_per_lecture ?? Infinity;
      if (limits.flashcards_per_lecture !== null && current + amount > limit) {
        return {
          allowed: false,
          tier,
          current,
          limit,
          reason: `You've generated ${current} of ${limit} flashcards this month. Upgrade for unlimited.`,
        };
      }
      break;
  }

  return { allowed: true, current, limit: limit === Infinity ? null : limit };
}

/**
 * Check if user can create another workspace.
 */
export async function checkWorkspaceQuota(userId: string): Promise<
  | { allowed: true; current: number; limit: number | null }
  | {
      allowed: false;
      tier: SubscriptionTier;
      current: number;
      limit: number;
      reason: string;
    }
> {
  const tier = await getUserTier(userId);
  const limits = TIER_LIMITS[tier];

  const sql = getSql();
  const [{ count }] = await sql<[{ count: number }]>`
    SELECT COUNT(*)::int AS count
    FROM workspaces
    WHERE owner_id = ${userId}
  `;

  if (limits.workspaces !== null && count >= limits.workspaces) {
    return {
      allowed: false,
      tier,
      current: count,
      limit: limits.workspaces,
      reason: `Free tier allows ${limits.workspaces} workspace. Upgrade to create more.`,
    };
  }

  return { allowed: true, current: count, limit: limits.workspaces };
}
