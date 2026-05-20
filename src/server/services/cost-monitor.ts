/**
 * Cost monitoring service.
 * 
 * Tracks daily AI usage costs and alerts when budgets are exceeded.
 * 
 * Features:
 * - Daily cost aggregation from usage_logs
 * - Budget threshold alerts (150% of target)
 * - Security event logging for cost spikes
 * - Automated checks via worker scheduler
 * 
 * Usage:
 *   import { checkCostBudget, getDailyCosts } from "./cost-monitor";
 *   
 *   // In worker scheduler (runs daily at 9am):
 *   await checkCostBudget();
 *   
 *   // Manual check:
 *   const costs = await getDailyCosts(new Date('2026-05-20'));
 *   console.log(`Today's costs: $${costs.total_usd.toFixed(2)}`);
 */

import { getSql } from "../db";
import { logCostSpike } from "../lib/logger";

export interface DailyCosts {
  transcription_usd: number;
  openai_usd: number;
  total_usd: number;
  date: string;
}

/**
 * Get aggregated costs for a specific date.
 * 
 * Cost calculation:
 * - Transcription: $0.10/hour → $0.00002778/second
 * - OpenAI queries: ~$0.02/query (estimated average)
 * - Total stored in usage_logs.total_cost_usd
 * 
 * @param date - Date to query (defaults to today)
 * @returns Cost breakdown by service
 */
export async function getDailyCosts(date: Date = new Date()): Promise<DailyCosts> {
  const sql = getSql();
  const dateStr = date.toISOString().slice(0, 10); // YYYY-MM-DD
  
  const rows = await sql<
    Array<{
      transcription_cost: number;
      openai_cost: number;
      total_cost: number;
    }>
  >`
    SELECT 
      COALESCE(SUM(CASE WHEN usage_type = 'transcription' THEN total_cost_usd ELSE 0 END), 0) as transcription_cost,
      COALESCE(SUM(CASE WHEN usage_type = 'ai_query' THEN total_cost_usd ELSE 0 END), 0) as openai_cost,
      COALESCE(SUM(total_cost_usd), 0) as total_cost
    FROM usage_logs
    WHERE DATE(created_at) = ${dateStr}
  `;
  
  const result = rows[0] || { transcription_cost: 0, openai_cost: 0, total_cost: 0 };
  
  return {
    transcription_usd: result.transcription_cost,
    openai_usd: result.openai_cost,
    total_usd: result.total_cost,
    date: dateStr,
  };
}

/**
 * Get monthly cost aggregation.
 * 
 * @param yearMonth - Format: "YYYY-MM" (e.g., "2026-05")
 * @returns Total costs for the month
 */
export async function getMonthlyCosts(yearMonth: string): Promise<DailyCosts> {
  const sql = getSql();
  
  const rows = await sql<
    Array<{
      transcription_cost: number;
      openai_cost: number;
      total_cost: number;
    }>
  >`
    SELECT 
      COALESCE(SUM(CASE WHEN usage_type = 'transcription' THEN total_cost_usd ELSE 0 END), 0) as transcription_cost,
      COALESCE(SUM(CASE WHEN usage_type = 'ai_query' THEN total_cost_usd ELSE 0 END), 0) as openai_cost,
      COALESCE(SUM(total_cost_usd), 0) as total_cost
    FROM usage_logs
    WHERE period = ${yearMonth}
  `;
  
  const result = rows[0] || { transcription_cost: 0, openai_cost: 0, total_cost: 0 };
  
  return {
    transcription_usd: result.transcription_cost,
    openai_usd: result.openai_cost,
    total_usd: result.total_cost,
    date: yearMonth,
  };
}

/**
 * Check if daily costs exceed budget threshold.
 * 
 * Alerts when costs reach 150% of configured budget.
 * Logs security event for investigation.
 * 
 * Environment Variable:
 *   DAILY_COST_BUDGET_USD=1000  # Default: $1000/day
 */
export async function checkCostBudget(): Promise<void> {
  const today = await getDailyCosts();
  const budget = parseFloat(process.env.DAILY_COST_BUDGET_USD || "1000");
  const threshold = budget * 1.5; // Alert at 150% of budget
  
  console.log(`[Cost Monitor] Daily costs: $${today.total_usd.toFixed(2)} / $${budget.toFixed(2)} budget`);
  
  if (today.total_usd > threshold) {
    // CRITICAL: Cost spike detected
    logCostSpike(
      "system", // No specific user - system-wide cost
      today.total_usd,
      budget,
      "daily"
    );
    
    console.error(
      `🚨 [Cost Monitor] CRITICAL: Daily costs ($${today.total_usd.toFixed(2)}) exceed 150% of budget ($${budget.toFixed(2)})`
    );
    console.error(`   - Transcription: $${today.transcription_usd.toFixed(2)}`);
    console.error(`   - OpenAI: $${today.openai_usd.toFixed(2)}`);
    console.error(`   - Action required: Check for abuse or bugs`);
  } else if (today.total_usd > budget) {
    // WARNING: Over budget but under critical threshold
    console.warn(
      `⚠️  [Cost Monitor] WARNING: Daily costs ($${today.total_usd.toFixed(2)}) exceed budget ($${budget.toFixed(2)})`
    );
  }
}

/**
 * Get top spenders for a given date.
 * Useful for identifying abuse or runaway costs.
 * 
 * @param date - Date to query
 * @param limit - Number of top users to return (default: 10)
 * @returns Array of users with their daily costs
 */
export async function getTopSpenders(
  date: Date = new Date(),
  limit: number = 10
): Promise<Array<{ user_id: string; total_cost_usd: number }>> {
  const sql = getSql();
  const dateStr = date.toISOString().slice(0, 10);
  
  return await sql<Array<{ user_id: string; total_cost_usd: number }>>`
    SELECT 
      user_id,
      SUM(total_cost_usd) as total_cost_usd
    FROM usage_logs
    WHERE DATE(created_at) = ${dateStr}
    GROUP BY user_id
    ORDER BY total_cost_usd DESC
    LIMIT ${limit}
  `;
}
