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

/**
 * All four tiers still EXIST. Only two are sold — see SELLABLE_TIERS.
 *
 * Hidden rather than deleted, deliberately. Deleting `student` and `team` from
 * the type would orphan any row that already carries one: the tier would fail
 * to typecheck, the limits lookup would return undefined, and an account that
 * was working yesterday would silently fall through to no quota at all. A tier
 * nobody can buy is harmless; a tier the code cannot describe is not.
 *
 * Both are hidden because neither is deliverable as written. `team` has no team:
 * every query in the app is scoped by `user_id`, `sendWorkspaceInvite()` has no
 * callers and there is no invite endpoint, so a second member would sign in to
 * an empty library. `student` needs edu verification to be a student discount
 * rather than a coupon anyone can claim, and that is its own project.
 *
 * Note this is the BILLING tier, unrelated to `account_kind` — which is also
 * 'student' | 'professional' and drives flashcards. Two different concepts that
 * happen to share a word.
 */
export type SubscriptionTier = "free" | "student" | "pro" | "team";

/**
 * The tiers a user can actually see and buy. The single source of truth for
 * "what do we sell", read by the pricing page, the paywall, and the admin
 * dropdown, so hiding a tier is one edit rather than four.
 */
export const SELLABLE_TIERS = ["free", "pro"] as const satisfies readonly SubscriptionTier[];

export function isSellableTier(tier: string): tier is (typeof SELLABLE_TIERS)[number] {
  return (SELLABLE_TIERS as readonly string[]).includes(tier);
}
export type UsageType = "transcription" | "ai_query" | "flashcard";

interface TierLimits {
  transcription_minutes: number | null; // null = unlimited
  ai_queries: number | null;
  flashcards_per_lecture: number | null;
  workspaces: number | null;
}

/**
 * Free is a TRIAL of the real product, not a free product.
 *
 * 300 minutes was five hours a month given away, which is more than most paid
 * users will ever record — there was no reason to upgrade. 120 minutes is
 * roughly four meetings: enough to learn whether the summaries are any good,
 * not enough to run a working week on.
 *
 * The queries move the other way, 10 -> 25. Ask is the feature that
 * demonstrates why a transcript is worth keeping, and rationing it to ten
 * questions a month meant most people never formed the habit the paid tier
 * sells. Give away the thing that creates the want; ration the thing that costs
 * money to serve.
 */
const TIER_LIMITS: Record<SubscriptionTier, TierLimits> = {
  free: {
    transcription_minutes: 120, // 2 hours — about four meetings
    ai_queries: 25,
    flashcards_per_lecture: 3,
    workspaces: 1,
  },
  // Hidden from sale (see SELLABLE_TIERS) but kept whole, so an existing row
  // carrying one of these still resolves to real limits instead of undefined.
  student: {
    transcription_minutes: null, // unlimited
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
  /**
   * Fair-use ceilings, not product limits — and the distinction has to survive
   * into the copy. 15 hours of recording a month is more than a heavy user
   * records; anyone who reaches it is either a team sharing an account or
   * something automated. The limit exists so a single account cannot run up an
   * unbounded AssemblyAI bill against a $9 subscription.
   *
   * Because these are no longer `null`, Pro now takes the same "limit reached"
   * path free users take. That path must NOT offer an upgrade — there is
   * nothing to upgrade to — which is why the quota error carries the tier.
   */
  pro: {
    transcription_minutes: 900, // 15 hours
    ai_queries: 500,
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
/**
 * Record what the pipeline spent, WITHOUT spending the user's query quota.
 *
 * The automatic summary used to call logAIQuery, which increments the same
 * `ai_queries_count` that gates Ask. Free tier allows 300 transcription minutes
 * and 10 AI queries, so a user recording 25-minute meetings hit the query cap
 * on meeting ten with transcription minutes still unspent — and had zero Ask
 * queries left. Not "few": zero. The one feature the product is differentiated
 * on was unreachable on the free tier for exactly the short in-person
 * conversations it is meant for, and the meter that hid it was our own.
 *
 * Cost still lands on the row, because that is real money and the margin model
 * depends on it. Only the quota counter is left alone: the user did not ask for
 * this, the pipeline did.
 */
export async function logPipelineAICost(
  userId: string,
  workspaceId: string | null,
  costUsd: number,
): Promise<void> {
  const sql = getSql();
  const period = getCurrentPeriod();

  await ensureUsageLog(sql, userId, workspaceId, period);

  await sql`
    UPDATE usage_logs
    SET
      total_cost_usd = total_cost_usd + ${costUsd},
      updated_at = now()
    WHERE user_id = ${userId}
      AND workspace_id IS NOT DISTINCT FROM ${workspaceId}
      AND period = ${period}
  `;
}

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
/**
 * First instant of next month, UTC — when the counters actually reset.
 *
 * Periods are keyed `YYYY-MM` in UTC (see getCurrentPeriod), so the reset is a
 * calendar boundary, not 30 days from the moment someone hit the wall. Returned
 * on every refusal because "try again later" is a lie about a monthly cap: the
 * wait can be 31 days, and a user who does not know that just retries.
 */
function currentPeriodEnd(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

/**
 * What to say when someone is out of quota.
 *
 * Tier-aware, because the same wall means two different things. A free user has
 * somewhere to go, so naming the ceiling is useful. A Pro user has NOT hit a
 * product limit — they have hit a fair-use ceiling that exists to stop one
 * account running an unbounded transcription bill — and telling them to upgrade
 * points at a tier that does not exist. Every string here also carries the reset,
 * because that is the only fact that tells someone what to actually do.
 */
function quotaReason(tier: SubscriptionTier, noun: string, current: number, limit: number): string {
  const used = `You've used ${current} of ${limit} ${noun} this month.`;
  return tier === "free"
    ? `${used} Upgrade to Pro for more, or wait for your allowance to reset.`
    : `${used} This is a fair-use ceiling on your plan — it resets at the start of next month.`;
}

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
      /** Which allowance ran out, so clients classify on a code, not a regex. */
      kind: UsageType;
      /** ISO instant the counters reset. */
      resets_on: string;
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
          reason: quotaReason(tier, "transcription minutes", current, limit),
          kind: "transcription",
          resets_on: currentPeriodEnd(),
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
          reason: quotaReason(tier, "questions", current, limit),
          kind: "ai_query",
          resets_on: currentPeriodEnd(),
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
          reason: quotaReason(tier, "flashcards", current, limit),
          kind: "flashcard",
          resets_on: currentPeriodEnd(),
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
