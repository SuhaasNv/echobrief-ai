/**
 * /api/v1/search — cross-meeting semantic Q&A (RAG), and the one place a
 * natural-language instruction turns into something the app does.
 *
 * Embeds the query, runs cosine-similarity search via the
 * `match_transcript_chunks` SQL function (pgvector), then streams a grounded
 * answer with citation metadata in a response header.
 *
 * A turn can also be an INSTRUCTION rather than a question. In that case the
 * body is empty and an `x-ask-action` header carries a plan — see
 * lib/ask-actions.ts for why routing and target resolution are split, and
 * services/ask-actions.ts for where the confirmation boundary is drawn.
 *
 * NOTHING IS MUTATED HERE. The endpoint answers or it plans; the writes stay in
 * PATCH /action-items/:id, PATCH /meetings/:id and DELETE /meetings/:id, which
 * the client calls as ordinary, separately-authorized requests. That keeps one
 * code path per mutation, keeps the mobile caches correct (those routes already
 * have hooks that invalidate properly), and means no database row has ever
 * changed as a side effect of a language model call.
 */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { stream } from "hono/streaming";
import { SearchRequest } from "../../../lib/schemas";
import { embedQuery } from "../../services/openai";
import { classifyAskIntent, streamGroundedAnswer } from "../../services/llm";
import { planAskAction } from "../../services/ask-actions";
import { PROMPTS } from "../../lib/prompts";
import { getSql } from "../../db";
import type { MatchedChunkRow } from "../../db/types";
import type { AppBindings } from "../types";
import { logAIQuery } from "../../services/usage-tracker";

const app = new Hono<AppBindings>();

/**
 * How many earlier turns the intent router is shown.
 *
 * USER turns only — see askIntentUser. Four is enough for "and the other one
 * too" to have somewhere to look without turning a classification prompt into a
 * transcript of the session.
 */
const INTENT_CONTEXT_TURNS = 4;

app.post("/", zValidator("json", SearchRequest), async (c) => {
  const { query, history, limit } = c.req.valid("json");
  const user = c.get("user");
  const workspaceId = c.get("workspaceId");
  const sql = getSql();

  /**
   * Routing and retrieval start together.
   *
   * Sequencing them would put a whole model round trip in front of every
   * ordinary question, which this screen cannot afford: its entire design rests
   * on citations landing in a header a second before the first answer token, and
   * a classifier in front of the embedding call would eat that lead. Run in
   * parallel, the common case (a question) pays nothing, and the rare case (an
   * instruction) throws away one embedding and one index scan — a fraction of a
   * cent and no user-visible time at all.
   */
  const intentPromise = classifyAskIntent({
    question: query,
    priorQuestions: history
      .filter((turn) => turn.role === "user")
      .slice(-INTENT_CONTEXT_TURNS)
      .map((turn) => turn.content),
  });

  const embeddingPromise = embedQuery(query);
  /**
   * An instruction turn returns without ever awaiting the embedding, so this
   * promise can reject with nobody listening — which in Node is a process-level
   * unhandled rejection, not a failed request. Attaching a sink marks it
   * handled without consuming it: the `await` below still sees the original
   * rejection and still turns it into a 500.
   */
  embeddingPromise.catch(() => undefined);

  const intent = await intentPromise;
  if (intent.intent !== "answer") {
    const plan = await planAskAction({ intent, userId: user.id, workspaceId });

    if (plan) {
      // An instruction spent a model call like any other turn.
      await logAIQuery(user.id, workspaceId);

      /**
       * Empty body, everything in the header.
       *
       * The alternative was a sentence in the body describing the action, and
       * it was rejected: on the action path there should be no free text on the
       * user's screen at all. The card is composed by the client out of typed
       * fields, so a model cannot author the words next to a Delete button.
       */
      c.header("content-type", "text/plain; charset=utf-8");
      c.header("cache-control", "no-cache");
      c.header("x-citations", encodeURIComponent(JSON.stringify([])));
      c.header("x-ask-action", encodeURIComponent(JSON.stringify(plan)));
      return c.body("");
    }
  }

  const embedding = await embeddingPromise;

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
