/**
 * /api/v1/share/:token — public, unauthenticated.
 */
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { getSql } from "../../db";
const app = new Hono();
app.get("/:token", async (c) => {
    const token = c.req.param("token");
    if (!/^[a-f0-9]{16,64}$/i.test(token)) {
        throw new HTTPException(400, { message: "Invalid share token" });
    }
    const sql = getSql();
    const rows = await sql `
    SELECT
      m.id, m.title, m.duration_sec, m.tags, m.created_at,
      s.executive, s.key_topics, s.decisions, s.open_questions
    FROM meetings m
    LEFT JOIN summaries s ON s.meeting_id = m.id
    WHERE m.share_token = ${token}
  `;
    const meeting = rows[0];
    if (!meeting)
        throw new HTTPException(404, { message: "Shared meeting not found" });
    const actionItems = await sql `
    SELECT description, assignee_name, due_date
    FROM action_items WHERE meeting_id = ${meeting.id}
  `;
    return c.json({ ...meeting, action_items: actionItems });
});
export default app;
//# sourceMappingURL=share.js.map