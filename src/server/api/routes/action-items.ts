/**
 * /api/v1/action-items
 */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { ActionItemPatchRequest, ActionItemExportRequest } from "../../../lib/schemas";
import { getSql } from "../../db";
import type { AppBindings } from "../types";

const app = new Hono<AppBindings>();

const ListQuery = z.object({
  completed: z
    .union([z.literal("true"), z.literal("false")])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  meeting_id: z.string().uuid().optional(),
  // Bounded, and `due_before` must actually be a date: it lands in a
  // `due_date <= $1` comparison, so free-form text reached Postgres and came
  // back as a 500 rather than a 400.
  assignee: z.string().trim().max(100).optional(),
  due_before: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "due_before must be YYYY-MM-DD")
    .optional(),
});

app.get("/", zValidator("query", ListQuery), async (c) => {
  const q = c.req.valid("query");
  const user = c.get("user");
  const workspaceId = c.get("workspaceId");
  const sql = getSql();

  const conditions = [sql`ai.user_id = ${user.id}`, sql`ai.workspace_id = ${workspaceId}`];
  if (q.completed !== undefined) conditions.push(sql`ai.completed = ${q.completed}`);
  if (q.meeting_id) conditions.push(sql`ai.meeting_id = ${q.meeting_id}`);
  if (q.assignee) conditions.push(sql`ai.assignee_name ILIKE ${`%${q.assignee}%`}`);
  if (q.due_before) conditions.push(sql`ai.due_date <= ${q.due_before}`);

  const where = conditions.reduce((acc, cur, i) => (i === 0 ? cur : sql`${acc} AND ${cur}`));

  /**
   * The Done list is ordered by completion, not by deadline.
   *
   * "Due Friday" is meaningless once something is finished, so a completed-only
   * list comes back most-recently-completed first. NULLS LAST keeps the rows
   * completed before we recorded a timestamp at the bottom, where the clients
   * render them as "Completed earlier".
   *
   * Only the explicitly completed=true list changes. A mixed list (no filter —
   * this is what the mobile app fetches) keeps the original deadline ordering,
   * because it is still mostly an Open list and the clients group it
   * client-side. This adds and removes no query parameters, so the pagination
   * contract is untouched.
   */
  const order = q.completed
    ? sql`ORDER BY ai.completed_at DESC NULLS LAST, ai.created_at DESC`
    : sql`ORDER BY ai.due_date NULLS LAST, ai.created_at DESC`;

  const items = await sql<
    Array<{
      id: string;
      meeting_id: string;
      meeting_title: string;
      meeting_date: string | null;
      description: string;
      assignee_name: string | null;
      assignee_id: string | null;
      due_date: string | null;
      completed: boolean;
      completed_at: string | null;
      timestamp_sec: number | null;
      export_refs: Record<string, string>;
      created_at: string;
    }>
  >`
    SELECT
      ai.id, ai.meeting_id, m.title AS meeting_title,
      -- When the item was CAPTURED, which is the meeting's date, not the row's.
      -- recorded_at is when the conversation happened and is the honest answer;
      -- it is nullable and best-effort (see 0011), so fall back to the
      -- meeting's created_at (upload time) exactly as that migration prescribes.
      COALESCE(m.recorded_at, m.created_at) AS meeting_date,
      ai.description, ai.assignee_name, ai.assignee_id, ai.due_date,
      ai.completed, ai.completed_at, ai.timestamp_sec, ai.export_refs, ai.created_at
    FROM action_items ai
    JOIN meetings m ON m.id = ai.meeting_id
    WHERE ${where}
    ${order}
  `;

  return c.json({ items });
});

app.patch("/:id", zValidator("json", ActionItemPatchRequest), async (c) => {
  const id = c.req.param("id");
  const patch = c.req.valid("json");
  const user = c.get("user");
  const workspaceId = c.get("workspaceId");
  const sql = getSql();

  const sets = [];
  if (patch.description !== undefined) sets.push(sql`description = ${patch.description}`);
  if (patch.assignee_name !== undefined) sets.push(sql`assignee_name = ${patch.assignee_name}`);
  if (patch.due_date !== undefined) sets.push(sql`due_date = ${patch.due_date}`);
  if (patch.completed !== undefined) {
    sets.push(sql`completed = ${patch.completed}`);

    /**
     * completed_at moves in the same UPDATE, and only on an actual transition.
     *
     * Inside SET, a bare column reference is the row's PRE-UPDATE value, so
     * `completed` here is the old state even though the line above is
     * reassigning it. That is what makes this idempotent: re-completing an
     * already-complete item keeps the original completed_at instead of bumping
     * it to now(). The clients re-send `completed: true` on any optimistic
     * retry, and without this guard every list refresh could quietly rewrite
     * the day the user finished the task.
     *
     * now() is the database clock, not the API process clock, so timestamps
     * stay comparable across instances with drifting system time.
     */
    sets.push(
      patch.completed
        ? sql`completed_at = CASE WHEN completed THEN completed_at ELSE now() END`
        : sql`completed_at = NULL`,
    );
  }
  if (sets.length === 0) return c.json({ ok: true });

  const setClause = sets.reduce((acc, cur, i) => (i === 0 ? cur : sql`${acc}, ${cur}`));

  // The user_id + workspace_id predicate is the ONLY thing standing between a
  // caller and another tenant's row: there is no RLS on this table.
  const updated = await sql<
    Array<{
      id: string;
      meeting_id: string;
      description: string;
      assignee_name: string | null;
      assignee_id: string | null;
      due_date: string | null;
      completed: boolean;
      completed_at: string | null;
      timestamp_sec: number | null;
      export_refs: Record<string, string>;
      created_at: string;
    }>
  >`
    UPDATE action_items SET ${setClause}
    WHERE id = ${id} AND user_id = ${user.id} AND workspace_id = ${workspaceId}
    RETURNING id, meeting_id, description, assignee_name, assignee_id, due_date,
              completed, completed_at, timestamp_sec, export_refs, created_at
  `;

  // Previously this returned ok:true whether or not a row matched, so a patch
  // against someone else's item — or a deleted one — looked like a success.
  const item = updated[0];
  if (!item) throw new HTTPException(404, { message: "Action item not found" });

  return c.json({ ok: true, item });
});

app.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const workspaceId = c.get("workspaceId");
  const sql = getSql();
  const result = await sql`
    DELETE FROM action_items WHERE id = ${id} AND user_id = ${user.id} AND workspace_id = ${workspaceId}
  `;
  if (result.count === 0) throw new HTTPException(404, { message: "Action item not found" });
  return c.json({ ok: true });
});

app.post("/:id/export", zValidator("json", ActionItemExportRequest), async (c) => {
  const id = c.req.param("id");
  const { provider } = c.req.valid("json");
  const user = c.get("user");
  const workspaceId = c.get("workspaceId");
  const sql = getSql();

  const items = await sql<
    Array<{ id: string; description: string; export_refs: Record<string, string> }>
  >`
    SELECT id, description, export_refs FROM action_items
    WHERE id = ${id} AND user_id = ${user.id} AND workspace_id = ${workspaceId}
  `;
  const item = items[0];
  if (!item) throw new HTTPException(404, { message: "Action item not found" });

  const integ = await sql<
    Array<{ provider: string }>
  >`SELECT provider FROM integrations WHERE user_id = ${user.id} AND provider = ${provider}`;
  if (integ.length === 0) {
    throw new HTTPException(400, {
      message: `${provider} is not connected. Connect it in Settings → Integrations.`,
    });
  }

  // TODO: per-provider export adapters (Notion / Linear / Jira / etc.)
  const stubExportId = `${provider}-${randomUUID().slice(0, 8)}`;
  const newRefs = { ...item.export_refs, [provider]: stubExportId };

  await sql`UPDATE action_items SET export_refs = ${JSON.stringify(newRefs)}::jsonb WHERE id = ${id}`;

  return c.json({ provider, external_id: stubExportId, external_url: null });
});

export default app;
