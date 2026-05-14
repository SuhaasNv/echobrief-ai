/**
 * /api/v1/meetings
 */
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { randomUUID, randomBytes } from "node:crypto";
import { UploadUrlRequest, UploadUrlResponse, ConfirmUploadRequest, MeetingListQuery, MeetingPatchRequest, MeetingStatusResponse, } from "../../../lib/schemas";
import { buildAudioKey, extensionFromMime, createPresignedUploadUrl, deleteAudioObject, } from "../../services/r2";
import { enqueueProcessingJob } from "../../services/queue";
import { getSql } from "../../db";
const app = new Hono();
// ---------------------------------------------------------------------------
// POST /upload-url
// ---------------------------------------------------------------------------
app.post("/upload-url", zValidator("json", UploadUrlRequest), async (c) => {
    const body = c.req.valid("json");
    const user = c.get("user");
    const sql = getSql();
    const meetingId = randomUUID();
    const ext = extensionFromMime(body.content_type);
    const audioKey = buildAudioKey(user.id, meetingId, ext);
    await sql `
    INSERT INTO meetings (
      id, user_id, title, audio_key, audio_size, audio_mime,
      duration_sec, language, tags, status
    ) VALUES (
      ${meetingId},
      ${user.id},
      ${body.title ?? body.filename.replace(/\.[^.]+$/, "")},
      ${audioKey},
      ${body.size},
      ${body.content_type},
      ${body.duration_sec ?? null},
      ${body.language},
      ${sql.array(body.tags)},
      'queued'
    )
  `;
    const { upload_url, expires_at } = await createPresignedUploadUrl(audioKey, body.content_type, body.size);
    return c.json(UploadUrlResponse.parse({
        meeting_id: meetingId,
        upload_url,
        audio_key: audioKey,
        expires_at,
    }));
});
// ---------------------------------------------------------------------------
// POST / — confirm upload and enqueue
// ---------------------------------------------------------------------------
app.post("/", zValidator("json", ConfirmUploadRequest), async (c) => {
    const { meeting_id } = c.req.valid("json");
    const user = c.get("user");
    const sql = getSql();
    const rows = await sql `
    SELECT id, user_id, audio_key, language, status
    FROM meetings
    WHERE id = ${meeting_id} AND user_id = ${user.id}
  `;
    const meeting = rows[0];
    if (!meeting)
        throw new HTTPException(404, { message: "Meeting not found" });
    if (!meeting.audio_key)
        throw new HTTPException(400, { message: "Meeting has no audio key" });
    await enqueueProcessingJob({
        meeting_id: meeting.id,
        user_id: meeting.user_id,
        audio_key: meeting.audio_key,
        language: meeting.language,
        retry_count: 0,
    });
    return c.json({ meeting_id, status: "queued" });
});
// ---------------------------------------------------------------------------
// GET / — list
// ---------------------------------------------------------------------------
app.get("/", zValidator("query", MeetingListQuery), async (c) => {
    const q = c.req.valid("query");
    const user = c.get("user");
    const sql = getSql();
    const offset = (q.page - 1) * q.limit;
    // Build dynamic conditions via postgres.js helper composability.
    const conditions = [sql `user_id = ${user.id}`];
    if (q.status)
        conditions.push(sql `status = ${q.status}`);
    if (q.tag)
        conditions.push(sql `${q.tag} = ANY(tags)`);
    if (q.from)
        conditions.push(sql `created_at >= ${q.from}`);
    if (q.to)
        conditions.push(sql `created_at <= ${q.to}`);
    if (q.q)
        conditions.push(sql `title ILIKE ${`%${q.q}%`}`);
    const whereClause = conditions.reduce((acc, cur, i) => i === 0 ? cur : sql `${acc} AND ${cur}`);
    const rows = await sql `
    SELECT
      m.id,
      m.title,
      m.status,
      m.duration_sec,
      m.tags,
      m.created_at,
      m.processed_at,
      s.executive AS summary_excerpt,
      (SELECT COUNT(*)::int FROM action_items ai WHERE ai.meeting_id = m.id) AS action_item_count
    FROM meetings m
    LEFT JOIN summaries s ON s.meeting_id = m.id
    WHERE ${whereClause}
    ORDER BY m.created_at DESC
    LIMIT ${q.limit} OFFSET ${offset}
  `;
    const [{ total }] = await sql `
    SELECT COUNT(*)::int AS total FROM meetings WHERE ${whereClause}
  `;
    return c.json({
        items: rows.map((r) => ({
            id: r.id,
            title: r.title,
            status: r.status,
            duration_sec: r.duration_sec,
            tags: r.tags ?? [],
            created_at: r.created_at,
            processed_at: r.processed_at,
            action_item_count: r.action_item_count,
            participant_count: 0,
            summary_excerpt: r.summary_excerpt,
        })),
        total,
        page: q.page,
        limit: q.limit,
    });
});
// ---------------------------------------------------------------------------
// GET /:id — detail with transcript + summary
// ---------------------------------------------------------------------------
app.get("/:id", async (c) => {
    const id = c.req.param("id");
    const user = c.get("user");
    const sql = getSql();
    const meetings = await sql `
    SELECT * FROM meetings WHERE id = ${id} AND user_id = ${user.id}
  `;
    const meeting = meetings[0];
    if (!meeting)
        throw new HTTPException(404, { message: "Meeting not found" });
    const [transcript] = await sql `SELECT raw_text, content, speakers FROM transcripts WHERE meeting_id = ${id}`;
    const [summary] = await sql `SELECT executive, key_topics, decisions, open_questions, chapters
    FROM summaries WHERE meeting_id = ${id}`;
    return c.json({ ...meeting, transcript: transcript ?? null, summary: summary ?? null });
});
// ---------------------------------------------------------------------------
// PATCH /:id — update title/tags/visibility
// ---------------------------------------------------------------------------
app.patch("/:id", zValidator("json", MeetingPatchRequest), async (c) => {
    const id = c.req.param("id");
    const patch = c.req.valid("json");
    const user = c.get("user");
    const sql = getSql();
    const sets = [];
    if (patch.title !== undefined)
        sets.push(sql `title = ${patch.title}`);
    if (patch.tags !== undefined)
        sets.push(sql `tags = ${sql.array(patch.tags)}`);
    if (patch.visibility !== undefined)
        sets.push(sql `visibility = ${patch.visibility}`);
    if (sets.length === 0)
        return c.json({ ok: true });
    const setClause = sets.reduce((acc, cur, i) => (i === 0 ? cur : sql `${acc}, ${cur}`));
    await sql `UPDATE meetings SET ${setClause} WHERE id = ${id} AND user_id = ${user.id}`;
    return c.json({ ok: true });
});
// ---------------------------------------------------------------------------
// DELETE /:id
// ---------------------------------------------------------------------------
app.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const user = c.get("user");
    const sql = getSql();
    const rows = await sql `SELECT audio_key FROM meetings WHERE id = ${id} AND user_id = ${user.id}`;
    const row = rows[0];
    if (!row)
        throw new HTTPException(404, { message: "Meeting not found" });
    if (row.audio_key) {
        await deleteAudioObject(row.audio_key).catch((e) => console.error("[r2-delete]", e));
    }
    await sql `DELETE FROM meetings WHERE id = ${id} AND user_id = ${user.id}`;
    return c.json({ ok: true });
});
// ---------------------------------------------------------------------------
// GET /:id/status — polling
// ---------------------------------------------------------------------------
app.get("/:id/status", async (c) => {
    const id = c.req.param("id");
    const user = c.get("user");
    const sql = getSql();
    const rows = await sql `
    SELECT id, status, failure_reason, duration_sec, audio_key
    FROM meetings WHERE id = ${id} AND user_id = ${user.id}
  `;
    const data = rows[0];
    if (!data)
        throw new HTTPException(404, { message: "Meeting not found" });
    const progress = {
        uploaded: data.audio_key !== null,
        transcribed: ["analyzing", "indexing", "complete"].includes(data.status),
        analyzed: ["indexing", "complete"].includes(data.status),
        indexed: data.status === "complete",
    };
    const estimated = data.status === "complete"
        ? 0
        : data.duration_sec
            ? Math.max(30, Math.floor(data.duration_sec / 20))
            : null;
    return c.json(MeetingStatusResponse.parse({
        id: data.id,
        status: data.status,
        progress,
        estimated_seconds_remaining: estimated,
        failure_reason: data.failure_reason,
    }));
});
// ---------------------------------------------------------------------------
// POST /:id/retry
// ---------------------------------------------------------------------------
app.post("/:id/retry", async (c) => {
    const id = c.req.param("id");
    const user = c.get("user");
    const sql = getSql();
    const rows = await sql `
    SELECT id, user_id, audio_key, language, status, retry_count
    FROM meetings WHERE id = ${id} AND user_id = ${user.id}
  `;
    const meeting = rows[0];
    if (!meeting)
        throw new HTTPException(404, { message: "Meeting not found" });
    if (meeting.status !== "failed") {
        throw new HTTPException(400, { message: "Meeting is not in a failed state" });
    }
    if (meeting.retry_count >= 3) {
        throw new HTTPException(400, { message: "Maximum retries reached" });
    }
    if (!meeting.audio_key) {
        throw new HTTPException(400, { message: "Audio file no longer available" });
    }
    await sql `UPDATE meetings SET status = 'queued', failure_reason = NULL WHERE id = ${id}`;
    await enqueueProcessingJob({
        meeting_id: meeting.id,
        user_id: meeting.user_id,
        audio_key: meeting.audio_key,
        language: meeting.language,
        retry_count: meeting.retry_count + 1,
    });
    return c.json({ ok: true });
});
// ---------------------------------------------------------------------------
// POST /:id/share — toggle share token
// ---------------------------------------------------------------------------
const ShareBody = z.object({ enabled: z.boolean() });
app.post("/:id/share", zValidator("json", ShareBody), async (c) => {
    const id = c.req.param("id");
    const { enabled } = c.req.valid("json");
    const user = c.get("user");
    const sql = getSql();
    const share_token = enabled ? randomBytes(16).toString("hex") : null;
    await sql `UPDATE meetings SET share_token = ${share_token} WHERE id = ${id} AND user_id = ${user.id}`;
    const env = await import("../../env").then((m) => m.getEnv());
    return c.json({
        share_token,
        share_url: share_token ? `${env.APP_URL}/share/${share_token}` : null,
    });
});
export default app;
//# sourceMappingURL=meetings.js.map