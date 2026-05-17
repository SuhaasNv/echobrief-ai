/**
 * /api/v1/flashcards — student-only. AI-generated Q/A pairs from a lecture
 * transcript plus a spaced-repetition review queue.
 *
 * Mount points:
 *   POST /api/v1/meetings/:id/flashcards/generate  — kind === 'student'
 *   GET  /api/v1/meetings/:id/flashcards
 *   GET  /api/v1/flashcards/review                 — across workspace
 *   PATCH /api/v1/flashcards/:id
 *   DELETE /api/v1/flashcards/:id
 *
 * The generate endpoint is the only one with a kind gate; the rest follow
 * standard workspace_id filtering.
 */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getSql } from "../../db";
import { generateFlashcards } from "../../services/llm";
import type { AppBindings } from "../types";
import type { FlashcardRow } from "../../db/types";

const app = new Hono<AppBindings>();

// ---------------------------------------------------------------------------
// POST /meetings/:id/flashcards/generate — student only
// ---------------------------------------------------------------------------
app.post("/meetings/:id/flashcards/generate", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const workspaceId = c.get("workspaceId");
  const workspaceKind = c.get("workspaceKind");
  const sql = getSql();

  if (workspaceKind !== "student") {
    throw new HTTPException(403, {
      message: "Flashcards are only available in student workspaces.",
    });
  }

  const rows = await sql<Array<{ title: string; raw_text: string | null; status: string }>>`
    SELECT m.title, m.status, t.raw_text
    FROM meetings m
    LEFT JOIN transcripts t ON t.meeting_id = m.id
    WHERE m.id = ${id} AND m.user_id = ${user.id} AND m.workspace_id = ${workspaceId}
  `;
  const meeting = rows[0];
  if (!meeting) throw new HTTPException(404, { message: "Lecture not found" });
  if (!meeting.raw_text) {
    throw new HTTPException(400, {
      message: "Transcript not ready yet. Wait for processing to finish.",
    });
  }

  const result = await generateFlashcards(meeting.raw_text, meeting.title);

  // Regeneration replaces the previous set for this lecture.
  await sql.begin(async (tx) => {
    await tx`DELETE FROM flashcards WHERE meeting_id = ${id} AND workspace_id = ${workspaceId}`;
    if (result.cards.length > 0) {
      await tx`
        INSERT INTO flashcards ${tx(
          result.cards.map((card) => ({
            meeting_id: id,
            workspace_id: workspaceId,
            user_id: user.id,
            question: card.question,
            answer: card.answer,
            difficulty: card.difficulty,
          })),
        )}
      `;
    }
  });

  const inserted = await sql<FlashcardRow[]>`
    SELECT * FROM flashcards
    WHERE meeting_id = ${id} AND workspace_id = ${workspaceId}
    ORDER BY created_at ASC
  `;

  return c.json({ items: inserted, cost_usd: result.cost_usd });
});

// ---------------------------------------------------------------------------
// GET /meetings/:id/flashcards — list for one lecture
// ---------------------------------------------------------------------------
app.get("/meetings/:id/flashcards", async (c) => {
  const id = c.req.param("id");
  const workspaceId = c.get("workspaceId");
  const sql = getSql();

  const items = await sql<FlashcardRow[]>`
    SELECT * FROM flashcards
    WHERE meeting_id = ${id} AND workspace_id = ${workspaceId}
    ORDER BY created_at ASC
  `;
  return c.json({ items });
});

// ---------------------------------------------------------------------------
// GET /flashcards/review — least-recently-reviewed first across the workspace
// ---------------------------------------------------------------------------
const ReviewQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

app.get("/flashcards/review", zValidator("query", ReviewQuery), async (c) => {
  const { limit } = c.req.valid("query");
  const user = c.get("user");
  const workspaceId = c.get("workspaceId");
  const sql = getSql();

  const items = await sql<
    Array<FlashcardRow & { meeting_title: string }>
  >`
    SELECT f.*, m.title AS meeting_title
    FROM flashcards f
    JOIN meetings m ON m.id = f.meeting_id
    WHERE f.user_id = ${user.id} AND f.workspace_id = ${workspaceId}
    ORDER BY f.last_reviewed_at ASC NULLS FIRST, f.created_at ASC
    LIMIT ${limit}
  `;
  return c.json({ items });
});

// ---------------------------------------------------------------------------
// PATCH /flashcards/:id — edit q/a/difficulty, or mark reviewed
// ---------------------------------------------------------------------------
const PatchBody = z.object({
  question: z.string().min(1).max(500).optional(),
  answer: z.string().min(1).max(2000).optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  mark_reviewed: z.boolean().optional(),
});

app.patch("/flashcards/:id", zValidator("json", PatchBody), async (c) => {
  const id = c.req.param("id");
  const patch = c.req.valid("json");
  const user = c.get("user");
  const workspaceId = c.get("workspaceId");
  const sql = getSql();

  const sets: ReturnType<typeof sql>[] = [];
  if (patch.question !== undefined) sets.push(sql`question = ${patch.question}`);
  if (patch.answer !== undefined) sets.push(sql`answer = ${patch.answer}`);
  if (patch.difficulty !== undefined) sets.push(sql`difficulty = ${patch.difficulty}`);
  if (patch.mark_reviewed) {
    sets.push(sql`last_reviewed_at = now()`);
    sets.push(sql`review_count = review_count + 1`);
  }
  if (sets.length === 0) return c.json({ ok: true });

  const setClause = sets.reduce((acc, cur, i) => (i === 0 ? cur : sql`${acc}, ${cur}`));
  const result = await sql`
    UPDATE flashcards SET ${setClause}
    WHERE id = ${id} AND user_id = ${user.id} AND workspace_id = ${workspaceId}
  `;
  if (result.count === 0) throw new HTTPException(404, { message: "Flashcard not found" });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// DELETE /flashcards/:id
// ---------------------------------------------------------------------------
app.delete("/flashcards/:id", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const workspaceId = c.get("workspaceId");
  const sql = getSql();
  const result = await sql`
    DELETE FROM flashcards
    WHERE id = ${id} AND user_id = ${user.id} AND workspace_id = ${workspaceId}
  `;
  if (result.count === 0) throw new HTTPException(404, { message: "Flashcard not found" });
  return c.json({ ok: true });
});

export default app;
