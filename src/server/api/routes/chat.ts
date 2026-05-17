/**
 * /api/v1/meetings/:id/chat — streaming per-meeting Q&A
 */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { stream } from "hono/streaming";
import { MeetingChatRequest } from "../../../lib/schemas";
import { streamGroundedAnswer } from "../../services/llm";
import { PROMPTS } from "../../lib/prompts";
import { getSql } from "../../db";
import type { AppBindings } from "../types";

const app = new Hono<AppBindings>();

app.post("/:id/chat", zValidator("json", MeetingChatRequest), async (c) => {
  const id = c.req.param("id");
  const { message, history } = c.req.valid("json");
  const user = c.get("user");
  const workspaceId = c.get("workspaceId");
  const sql = getSql();

  const rows = await sql<Array<{ title: string; status: string; raw_text: string | null }>>`
    SELECT m.title, m.status, t.raw_text
    FROM meetings m
    LEFT JOIN transcripts t ON t.meeting_id = m.id
    WHERE m.id = ${id} AND m.user_id = ${user.id} AND m.workspace_id = ${workspaceId}
  `;
  const meeting = rows[0];
  if (!meeting) throw new HTTPException(404, { message: "Meeting not found" });
  if (meeting.status !== "complete") {
    throw new HTTPException(400, {
      message: "Meeting is still processing. Try again once it's complete.",
    });
  }
  if (!meeting.raw_text) {
    throw new HTTPException(400, { message: "No transcript available for this meeting" });
  }

  const systemContext = PROMPTS.perMeetingQaSystem(meeting.raw_text, meeting.title);
  const answerStream = await streamGroundedAnswer({
    systemContext,
    history,
    userMessage: message,
  });

  c.header("content-type", "text/plain; charset=utf-8");
  c.header("cache-control", "no-cache");
  c.header("x-accel-buffering", "no");

  return stream(c, async (s) => {
    const reader = answerStream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await s.write(value);
      }
    } finally {
      reader.releaseLock();
    }
  });
});

export default app;
