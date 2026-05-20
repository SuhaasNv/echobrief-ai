/**
 * /api/v1/search — cross-meeting semantic Q&A (RAG).
 *
 * Embeds the query, runs cosine-similarity search via the
 * `match_transcript_chunks` SQL function (pgvector), then streams a grounded
 * answer with citation metadata in a response header.
 */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { stream } from "hono/streaming";
import { SearchRequest } from "../../../lib/schemas";
import { embedQuery } from "../../services/openai";
import { streamGroundedAnswer } from "../../services/llm";
import { PROMPTS } from "../../lib/prompts";
import { getSql } from "../../db";
import type { MatchedChunkRow } from "../../db/types";
import type { AppBindings } from "../types";
import { logAIQuery } from "../../services/usage-tracker";

const app = new Hono<AppBindings>();

app.post("/", zValidator("json", SearchRequest), async (c) => {
  const { query, history, limit } = c.req.valid("json");
  const user = c.get("user");
  const workspaceId = c.get("workspaceId");
  const sql = getSql();

  const embedding = await embedQuery(query);

  // pgvector accepts a vector literal in `'[1.0,2.0,...]'` format. postgres.js
  // doesn't have first-class vector encoding; we stringify ourselves.
  const vecLiteral = `[${embedding.join(",")}]`;

  const matches = await sql<MatchedChunkRow[]>`
    SELECT
      c.id,
      c.meeting_id,
      m.title AS meeting_title,
      c.content,
      c.start_sec,
      c.end_sec,
      (1 - (c.embedding <=> ${vecLiteral}::vector))::real AS similarity
    FROM transcript_chunks c
    JOIN meetings m ON m.id = c.meeting_id
    WHERE c.user_id = ${user.id}
      AND c.workspace_id = ${workspaceId}
      AND (1 - (c.embedding <=> ${vecLiteral}::vector)) > 0.5
    ORDER BY c.embedding <=> ${vecLiteral}::vector
    LIMIT ${limit}
  `;

  if (matches.length === 0) {
    return c.json({
      answer: "I couldn't find relevant context for that question in your meetings.",
      citations: [],
    });
  }

  const citations = matches.map((m) => ({
    meeting_id: m.meeting_id,
    meeting_title: m.meeting_title,
    start_sec: m.start_sec ?? 0,
    end_sec: m.end_sec ?? 0,
    excerpt: m.content.slice(0, 300),
    similarity: m.similarity,
  }));

  const systemContext = PROMPTS.crossMeetingQaSystem(
    matches.map((m) => ({
      meeting_title: m.meeting_title,
      content: m.content,
      start_sec: m.start_sec ?? 0,
    })),
  );

  const answerStream = await streamGroundedAnswer({
    systemContext,
    history,
    userMessage: query,
  });

  // Log AI query for quota tracking
  await logAIQuery(user.id, workspaceId);

  c.header("content-type", "text/plain; charset=utf-8");
  c.header("cache-control", "no-cache");
  c.header("x-citations", encodeURIComponent(JSON.stringify(citations)));

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
