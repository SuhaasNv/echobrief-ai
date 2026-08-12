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

  // Two things used to make this return nothing even for obviously-answerable
  // questions:
  //
  // 1. RECALL. The ivfflat index (migration 0001) is built with lists = 100,
  //    and Postgres defaults ivfflat.probes to 1 — so the ORDER BY index scan
  //    only looked at ~1/100th of the vector space and skipped the correct
  //    chunk entirely. Measured on a single-chunk workspace: probes=1 returned
  //    0 rows, probes=100 returned the match. sqrt(lists) is the usual
  //    starting point, so 10 buys most of the recall for a fraction of the
  //    scan. SET LOCAL keeps it scoped to this transaction — connections are
  //    pooled, so a session-level SET would leak into unrelated queries.
  //
  // 2. THRESHOLD. The floor was 0.5, but text-embedding-3-small produces
  //    fairly low absolute cosine scores on short chunks: a directly relevant
  //    query/chunk pair measured 0.495 and was discarded just under the line.
  //    0.25 still excludes genuine noise while letting real matches through;
  //    ORDER BY + LIMIT does the actual ranking.
  const matches = await sql.begin(async (tx) => {
    // Constant, not user input — safe to inline (SET LOCAL takes no params).
    await tx.unsafe("SET LOCAL ivfflat.probes = 10");
    return tx<MatchedChunkRow[]>`
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
        AND (1 - (c.embedding <=> ${vecLiteral}::vector)) > 0.25
      ORDER BY c.embedding <=> ${vecLiteral}::vector
      LIMIT ${limit}
    `;
  });

  if (matches.length === 0) {
    // Match the streaming contract the success path uses. This returned JSON
    // while every other path returns text/plain, but the client consumes the
    // body as a raw text stream unconditionally — so the user saw the literal
    // `{"answer":"...","citations":[]}` rendered as the answer.
    c.header("content-type", "text/plain; charset=utf-8");
    c.header("cache-control", "no-cache");
    c.header("x-citations", encodeURIComponent(JSON.stringify([])));
    return c.body("I couldn't find relevant context for that question in your meetings.");
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
