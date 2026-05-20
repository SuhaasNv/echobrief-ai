/**
 * /api/v1/analytics — workspace analytics and metrics.
 *
 * Provides aggregated statistics for dashboard and analytics page.
 * All queries are workspace-scoped for multi-tenancy.
 */

import { Hono } from "hono";
import { getSql } from "../../db";
import type { AppBindings } from "../types";

const app = new Hono<AppBindings>();

interface AnalyticsSummary {
  total_meetings: number;
  total_minutes: number;
  recent_meetings: number;
  avg_meeting_score: number | null;
  total_cost_usd: number;
  meeting_trend: Array<{ date: string; count: number }>;
  top_tags: Array<{ tag: string; count: number }>;
  action_item_stats: {
    total: number;
    completed: number;
    completion_rate: number;
  };
}

/**
 * GET /summary — aggregated workspace analytics.
 *
 * Returns comprehensive stats for dashboard and analytics page.
 * All metrics are scoped to the current workspace.
 */
app.get("/summary", async (c) => {
  const user = c.get("user");
  const workspaceId = c.get("workspaceId");
  const sql = getSql();

  // Main meeting stats
  const [stats] = await sql<
    Array<{
      total_meetings: string;
      total_minutes: string;
      recent_meetings: string;
      avg_score: string | null;
    }>
  >`
    SELECT
      COUNT(DISTINCT m.id)::TEXT AS total_meetings,
      COALESCE(SUM(m.duration_sec), 0)::TEXT AS total_minutes,
      COUNT(DISTINCT CASE 
        WHEN m.created_at > NOW() - INTERVAL '30 days' 
        THEN m.id 
      END)::TEXT AS recent_meetings,
      AVG(
        CASE 
          WHEN m.meeting_score IS NOT NULL 
            AND (m.meeting_score->>'overall')::TEXT ~ '^[0-9]+$'
          THEN (m.meeting_score->>'overall')::INT 
        END
      )::TEXT AS avg_score
    FROM meetings m
    WHERE m.user_id = ${user.id} 
      AND m.workspace_id = ${workspaceId}
      AND m.status = 'complete'
  `;

  // Total cost from pipeline logs
  const [costResult] = await sql<Array<{ total_cost: string }>>`
    SELECT COALESCE(SUM(pl.cost_usd), 0)::TEXT AS total_cost
    FROM pipeline_logs pl
    JOIN meetings m ON m.id = pl.meeting_id
    WHERE m.user_id = ${user.id} 
      AND m.workspace_id = ${workspaceId}
  `;

  // Meeting trend (last 30 days)
  const trendData = await sql<
    Array<{ date: string; count: string }>
  >`
    SELECT
      DATE(m.created_at) AS date,
      COUNT(*)::TEXT AS count
    FROM meetings m
    WHERE m.user_id = ${user.id}
      AND m.workspace_id = ${workspaceId}
      AND m.created_at > NOW() - INTERVAL '30 days'
      AND m.status = 'complete'
    GROUP BY DATE(m.created_at)
    ORDER BY date ASC
  `;

  // Top tags by frequency
  const topTags = await sql<Array<{ tag: string; count: string }>>`
    SELECT
      unnest(m.tags) AS tag,
      COUNT(*)::TEXT AS count
    FROM meetings m
    WHERE m.user_id = ${user.id}
      AND m.workspace_id = ${workspaceId}
      AND m.status = 'complete'
      AND array_length(m.tags, 1) > 0
    GROUP BY tag
    ORDER BY COUNT(*) DESC
    LIMIT 10
  `;

  // Action item stats
  const [actionStats] = await sql<
    Array<{
      total: string;
      completed: string;
    }>
  >`
    SELECT
      COUNT(*)::TEXT AS total,
      COUNT(*) FILTER (WHERE ai.completed = true)::TEXT AS completed
    FROM action_items ai
    JOIN meetings m ON m.id = ai.meeting_id
    WHERE ai.user_id = ${user.id}
      AND m.workspace_id = ${workspaceId}
  `;

  const totalMeetings = parseInt(stats.total_meetings, 10);
  const totalMinutes = Math.floor(parseInt(stats.total_minutes, 10) / 60);
  const recentMeetings = parseInt(stats.recent_meetings, 10);
  const avgScore = stats.avg_score ? parseFloat(stats.avg_score) : null;
  const totalCost = parseFloat(costResult.total_cost);

  const totalActions = parseInt(actionStats.total, 10);
  const completedActions = parseInt(actionStats.completed, 10);
  const completionRate = totalActions > 0 ? (completedActions / totalActions) * 100 : 0;

  const summary: AnalyticsSummary = {
    total_meetings: totalMeetings,
    total_minutes: totalMinutes,
    recent_meetings: recentMeetings,
    avg_meeting_score: avgScore,
    total_cost_usd: totalCost,
    meeting_trend: trendData.map((row) => ({
      date: row.date,
      count: parseInt(row.count, 10),
    })),
    top_tags: topTags.map((row) => ({
      tag: row.tag,
      count: parseInt(row.count, 10),
    })),
    action_item_stats: {
      total: totalActions,
      completed: completedActions,
      completion_rate: Math.round(completionRate * 10) / 10, // Round to 1 decimal
    },
  };

  return c.json(summary);
});

export default app;
