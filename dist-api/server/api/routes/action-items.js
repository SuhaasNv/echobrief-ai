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
const app = new Hono();
const ListQuery = z.object({
    completed: z
        .union([z.literal("true"), z.literal("false")])
        .optional()
        .transform((v) => (v === undefined ? undefined : v === "true")),
    meeting_id: z.string().uuid().optional(),
    assignee: z.string().optional(),
    due_before: z.string().optional(),
});
app.get("/", zValidator("query", ListQuery), async (c) => {
    const q = c.req.valid("query");
    const user = c.get("user");
    const sql = getSql();
    const conditions = [sql `ai.user_id = ${user.id}`];
    if (q.completed !== undefined)
        conditions.push(sql `ai.completed = ${q.completed}`);
    if (q.meeting_id)
        conditions.push(sql `ai.meeting_id = ${q.meeting_id}`);
    if (q.assignee)
        conditions.push(sql `ai.assignee_name ILIKE ${`%${q.assignee}%`}`);
    if (q.due_before)
        conditions.push(sql `ai.due_date <= ${q.due_before}`);
    const where = conditions.reduce((acc, cur, i) => (i === 0 ? cur : sql `${acc} AND ${cur}`));
    const items = await sql `
    SELECT
      ai.id, ai.meeting_id, m.title AS meeting_title,
      ai.description, ai.assignee_name, ai.assignee_id, ai.due_date,
      ai.completed, ai.timestamp_sec, ai.export_refs, ai.created_at
    FROM action_items ai
    JOIN meetings m ON m.id = ai.meeting_id
    WHERE ${where}
    ORDER BY ai.due_date NULLS LAST, ai.created_at DESC
  `;
    return c.json({ items });
});
app.patch("/:id", zValidator("json", ActionItemPatchRequest), async (c) => {
    const id = c.req.param("id");
    const patch = c.req.valid("json");
    const user = c.get("user");
    const sql = getSql();
    const sets = [];
    if (patch.description !== undefined)
        sets.push(sql `description = ${patch.description}`);
    if (patch.assignee_name !== undefined)
        sets.push(sql `assignee_name = ${patch.assignee_name}`);
    if (patch.due_date !== undefined)
        sets.push(sql `due_date = ${patch.due_date}`);
    if (patch.completed !== undefined) {
        sets.push(sql `completed = ${patch.completed}`);
        sets.push(sql `completed_at = ${patch.completed ? new Date().toISOString() : null}`);
    }
    if (sets.length === 0)
        return c.json({ ok: true });
    const setClause = sets.reduce((acc, cur, i) => (i === 0 ? cur : sql `${acc}, ${cur}`));
    await sql `UPDATE action_items SET ${setClause} WHERE id = ${id} AND user_id = ${user.id}`;
    return c.json({ ok: true });
});
app.post("/:id/export", zValidator("json", ActionItemExportRequest), async (c) => {
    const id = c.req.param("id");
    const { provider } = c.req.valid("json");
    const user = c.get("user");
    const sql = getSql();
    const items = await sql `
    SELECT id, description, export_refs FROM action_items
    WHERE id = ${id} AND user_id = ${user.id}
  `;
    const item = items[0];
    if (!item)
        throw new HTTPException(404, { message: "Action item not found" });
    const integ = await sql `SELECT provider FROM integrations WHERE user_id = ${user.id} AND provider = ${provider}`;
    if (integ.length === 0) {
        throw new HTTPException(400, {
            message: `${provider} is not connected. Connect it in Settings → Integrations.`,
        });
    }
    // TODO: per-provider export adapters (Notion / Linear / Jira / etc.)
    const stubExportId = `${provider}-${randomUUID().slice(0, 8)}`;
    const newRefs = { ...item.export_refs, [provider]: stubExportId };
    await sql `UPDATE action_items SET export_refs = ${JSON.stringify(newRefs)}::jsonb WHERE id = ${id}`;
    return c.json({ provider, external_id: stubExportId, external_url: null });
});
export default app;
//# sourceMappingURL=action-items.js.map