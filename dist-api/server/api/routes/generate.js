/**
 * /api/v1/generate
 */
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { stream } from "hono/streaming";
import { EmailGenerationRequest } from "../../../lib/schemas";
import { generateEmail } from "../../services/llm";
import { getSql } from "../../db";
const app = new Hono();
app.post("/email", zValidator("json", EmailGenerationRequest), async (c) => {
    const { meeting_id, type, tone } = c.req.valid("json");
    const user = c.get("user");
    const sql = getSql();
    const rows = await sql `
    SELECT
      m.title, m.status,
      s.executive, s.key_topics, s.decisions, s.open_questions, s.chapters,
      t.speakers
    FROM meetings m
    LEFT JOIN summaries s ON s.meeting_id = m.id
    LEFT JOIN transcripts t ON t.meeting_id = m.id
    WHERE m.id = ${meeting_id} AND m.user_id = ${user.id}
  `;
    const meeting = rows[0];
    if (!meeting)
        throw new HTTPException(404, { message: "Meeting not found" });
    if (meeting.status !== "complete") {
        throw new HTTPException(400, { message: "Meeting is still processing" });
    }
    if (!meeting.executive) {
        throw new HTTPException(400, { message: "No summary available" });
    }
    const actionItems = await sql `
    SELECT description, assignee_name, due_date, timestamp_sec
    FROM action_items WHERE meeting_id = ${meeting_id}
  `;
    const participants = (meeting.speakers ?? []).map((s) => s.label);
    const emailStream = await generateEmail({
        type,
        tone,
        summary: {
            executive: meeting.executive,
            key_topics: meeting.key_topics ?? [],
            decisions: meeting.decisions ?? [],
            open_questions: meeting.open_questions ?? [],
            chapters: meeting.chapters ?? [],
        },
        actionItems: [...actionItems],
        participants,
    });
    c.header("content-type", "text/plain; charset=utf-8");
    c.header("cache-control", "no-cache");
    return stream(c, async (s) => {
        const reader = emailStream.getReader();
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                await s.write(value);
            }
        }
        finally {
            reader.releaseLock();
        }
    });
});
export default app;
//# sourceMappingURL=generate.js.map