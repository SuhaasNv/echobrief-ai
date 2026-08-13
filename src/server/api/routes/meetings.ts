/**
 * /api/v1/meetings
 */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { randomUUID, randomBytes } from "node:crypto";
import type { AppBindings } from "../types";
import {
  UploadUrlRequest,
  UploadUrlResponse,
  ConfirmUploadRequest,
  TranscriptUploadRequest,
  TranscriptUploadResponse,
  LiveUploadRequest,
  MeetingListQuery,
  MeetingPatchRequest,
  SpeakerNamesRequest,
  MeetingStatusResponse,
} from "../../../lib/schemas";
import {
  buildAudioKey,
  extensionFromMime,
  createPresignedUploadUrl,
  createSignedReadUrl,
  deleteAudioObject,
} from "../../services/r2";
import { enqueueProcessingJob, reenqueueProcessingJob } from "../../services/queue";
import { getSql } from "../../db";
import type { MeetingRow } from "../../db/types";

const app = new Hono<AppBindings>();

/** Oldest recording date we'll believe. Audio predating this is a bad clock. */
const EARLIEST_PLAUSIBLE_RECORDING = new Date("2000-01-01T00:00:00Z").getTime();

/**
 * Accept a client-supplied recording time only if it's plausible.
 *
 * The browser reports File.lastModified, which is usually the recording time
 * but is trivially wrong: copying a file, restoring a backup, or a skewed
 * device clock all rewrite it. Rather than date a meeting to 1970 or next
 * year, reject the implausible and return null so callers fall back to the
 * upload time.
 */
function sanitizeRecordedAt(value: string | undefined): string | null {
  if (!value) return null;
  const ts = new Date(value).getTime();
  if (Number.isNaN(ts)) return null;
  // A small future skew is normal (client clock ahead); a day is not.
  if (ts > Date.now() + 24 * 60 * 60 * 1000) return null;
  if (ts < EARLIEST_PLAUSIBLE_RECORDING) return null;
  return new Date(ts).toISOString();
}

/**
 * Reject an R2 object key that does not live under the caller's own prefix.
 *
 * `audio_key` on /from-live is the ONLY place the client hands us a storage key
 * instead of us minting one. Without this check an authenticated user could
 * post `<other-user-id>/<meeting-id>/original.webm`, then read that object back
 * through GET /meetings/:id/audio-url (which signs whatever key is on the row)
 * or destroy it through DELETE /meetings/:id. buildAudioKey() always prefixes
 * with the owner's user id, so the prefix is the ownership boundary.
 */
function assertOwnedAudioKey(audioKey: string, userId: string): void {
  const prefix = `${userId}/`;
  if (!audioKey.startsWith(prefix) || audioKey.includes("..")) {
    throw new HTTPException(403, { message: "audio_key does not belong to this account" });
  }
}

// ---------------------------------------------------------------------------
// POST /upload-url
// ---------------------------------------------------------------------------
app.post("/upload-url", zValidator("json", UploadUrlRequest), async (c) => {
  const body = c.req.valid("json");
  const user = c.get("user");
  const workspaceId = c.get("workspaceId");
  const sql = getSql();

  const meetingId = randomUUID();
  const ext = extensionFromMime(body.content_type);
  const audioKey = buildAudioKey(user.id, meetingId, ext);

  await sql`
    INSERT INTO meetings (
      id, user_id, workspace_id, title, audio_key, audio_size, audio_mime,
      duration_sec, language, tags, status, recorded_at
    ) VALUES (
      ${meetingId},
      ${user.id},
      ${workspaceId},
      ${body.title ?? body.filename.replace(/\.[^.]+$/, "")},
      ${audioKey},
      ${body.size},
      ${body.content_type},
      ${body.duration_sec ?? null},
      ${body.language},
      ${sql.array(body.tags)},
      'queued',
      ${sanitizeRecordedAt(body.recorded_at)}
    )
  `;

  const { upload_url, expires_at } = await createPresignedUploadUrl(
    audioKey,
    body.content_type,
    body.size,
  );

  return c.json(
    UploadUrlResponse.parse({
      meeting_id: meetingId,
      upload_url,
      audio_key: audioKey,
      expires_at,
    }),
  );
});

// ---------------------------------------------------------------------------
// POST /from-transcript — direct transcript upload (skips AssemblyAI)
// ---------------------------------------------------------------------------
app.post("/from-transcript", zValidator("json", TranscriptUploadRequest), async (c) => {
  const body = c.req.valid("json");
  const user = c.get("user");
  const workspaceId = c.get("workspaceId");
  const sql = getSql();

  const meetingId = randomUUID();
  // Rough duration estimate: 150 spoken words per minute average.
  const wordCount = body.transcript_text.split(/\s+/).filter(Boolean).length;
  const estimatedSec = Math.max(60, Math.round((wordCount / 150) * 60));

  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO meetings (id, user_id, workspace_id, title, duration_sec, language, tags, status)
      VALUES (
        ${meetingId},
        ${user.id},
        ${workspaceId},
        ${body.title},
        ${estimatedSec},
        ${body.language},
        ${tx.array(body.tags)},
        'queued'
      )
    `;
    await tx`
      INSERT INTO transcripts (meeting_id, raw_text, content, speakers, language, provider)
      VALUES (
        ${meetingId},
        ${body.transcript_text},
        '{}'::jsonb,
        '[]'::jsonb,
        ${body.language},
        'user'
      )
    `;
  });

  await enqueueProcessingJob({
    meeting_id: meetingId,
    user_id: user.id,
    audio_key: "", // sentinel: empty audio_key + existing transcript row triggers the skip-transcription path in the worker
    language: body.language,
    retry_count: 0,
  });

  return c.json(TranscriptUploadResponse.parse({ meeting_id: meetingId, status: "queued" }));
});

// ---------------------------------------------------------------------------
// POST /from-live — live-recording: client already has the AssemblyAI
// transcript AND has uploaded the audio blob to R2. We just need to persist
// the meeting + transcript rows, then kick off analyze/embed (no transcribe).
// ---------------------------------------------------------------------------
app.post("/from-live", zValidator("json", LiveUploadRequest), async (c) => {
  const body = c.req.valid("json");
  const user = c.get("user");
  const workspaceId = c.get("workspaceId");
  const sql = getSql();

  assertOwnedAudioKey(body.audio_key, user.id);

  const meetingId = randomUUID();

  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO meetings (
        id, user_id, workspace_id, title, audio_key, audio_size, audio_mime,
        duration_sec, language, tags, status
      ) VALUES (
        ${meetingId},
        ${user.id},
        ${workspaceId},
        ${body.title},
        ${body.audio_key},
        ${body.audio_size},
        ${body.audio_mime},
        ${body.duration_sec},
        ${body.language},
        ${tx.array(body.tags)},
        'queued'
      )
    `;
    await tx`
      INSERT INTO transcripts (meeting_id, raw_text, content, speakers, language, provider)
      VALUES (
        ${meetingId},
        ${body.transcript_text},
        '{}'::jsonb,
        '[]'::jsonb,
        ${body.language},
        'assemblyai-streaming'
      )
    `;
  });

  // Same skip-transcribe sentinel as /from-transcript: the worker sees an
  // existing transcript row and an empty audio_key in the job payload, and
  // jumps straight to analyze/embed/score. The meeting row still carries the
  // real audio_key so the user can play back the recording.
  await enqueueProcessingJob({
    meeting_id: meetingId,
    user_id: user.id,
    audio_key: "",
    language: body.language,
    retry_count: 0,
  });

  return c.json(TranscriptUploadResponse.parse({ meeting_id: meetingId, status: "queued" }));
});

// ---------------------------------------------------------------------------
// POST / — confirm upload and enqueue
// ---------------------------------------------------------------------------
app.post("/", zValidator("json", ConfirmUploadRequest), async (c) => {
  const { meeting_id } = c.req.valid("json");
  const user = c.get("user");
  const workspaceId = c.get("workspaceId");
  const sql = getSql();

  const rows = await sql<MeetingRow[]>`
    SELECT id, user_id, audio_key, language, status
    FROM meetings
    WHERE id = ${meeting_id} AND user_id = ${user.id} AND workspace_id = ${workspaceId}
  `;
  const meeting = rows[0];
  if (!meeting) throw new HTTPException(404, { message: "Meeting not found" });
  if (!meeting.audio_key) throw new HTTPException(400, { message: "Meeting has no audio key" });

  await enqueueProcessingJob({
    meeting_id: meeting.id,
    user_id: meeting.user_id,
    audio_key: meeting.audio_key,
    language: meeting.language,
    retry_count: 0,
  });

  return c.json({ meeting_id, status: "queued" as const });
});

// ---------------------------------------------------------------------------
// GET / — list
// ---------------------------------------------------------------------------
app.get("/", zValidator("query", MeetingListQuery), async (c) => {
  const q = c.req.valid("query");
  const user = c.get("user");
  const workspaceId = c.get("workspaceId");
  const sql = getSql();

  const offset = (q.page - 1) * q.limit;

  // Build dynamic conditions via postgres.js helper composability.
  const conditions = [sql`user_id = ${user.id}`, sql`workspace_id = ${workspaceId}`];
  if (q.status) conditions.push(sql`status = ${q.status}`);
  if (q.tag) conditions.push(sql`${q.tag} = ANY(tags)`);
  if (q.from) conditions.push(sql`created_at >= ${q.from}`);
  if (q.to) conditions.push(sql`created_at <= ${q.to}`);
  if (q.q) conditions.push(sql`title ILIKE ${`%${q.q}%`}`);

  const whereClause = conditions.reduce((acc, cur, i) => (i === 0 ? cur : sql`${acc} AND ${cur}`));

  const rows = await sql<
    Array<{
      id: string;
      title: string;
      status: string;
      duration_sec: number | null;
      tags: string[];
      created_at: string;
      recorded_at: string | null;
      processed_at: string | null;
      summary_excerpt: string | null;
      action_item_count: number;
      participant_count: number;
    }>
  >`
    SELECT
      m.id,
      m.title,
      m.status,
      m.duration_sec,
      m.tags,
      m.created_at,
      m.recorded_at,
      m.processed_at,
      s.executive AS summary_excerpt,
      (SELECT COUNT(*)::int FROM action_items ai WHERE ai.meeting_id = m.id) AS action_item_count,
      -- speakers is stored double-encoded (a JSONB *string* holding an array)
      -- for every row the worker has ever written, so an 'array' check alone
      -- always reported 0 participants. Handle both shapes.
      COALESCE((
        SELECT CASE
          WHEN jsonb_typeof(t.speakers) = 'array' THEN jsonb_array_length(t.speakers)
          WHEN jsonb_typeof(t.speakers) = 'string' THEN
            jsonb_array_length((t.speakers #>> '{}')::jsonb)
          ELSE 0
        END
        FROM transcripts t
        WHERE t.meeting_id = m.id
      ), 0)::int AS participant_count
    FROM meetings m
    LEFT JOIN summaries s ON s.meeting_id = m.id
    WHERE ${whereClause}
    ORDER BY m.created_at DESC
    LIMIT ${q.limit} OFFSET ${offset}
  `;

  const [{ total }] = await sql<[{ total: number }]>`
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
      recorded_at: r.recorded_at ?? null,
      processed_at: r.processed_at,
      action_item_count: r.action_item_count,
      participant_count: r.participant_count,
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
  const workspaceId = c.get("workspaceId");
  const sql = getSql();

  const meetings = await sql<MeetingRow[]>`
    SELECT * FROM meetings WHERE id = ${id} AND user_id = ${user.id} AND workspace_id = ${workspaceId}
  `;
  const meeting = meetings[0];
  if (!meeting) throw new HTTPException(404, { message: "Meeting not found" });

  const [transcriptRow] = await sql<
    Array<{
      raw_text: string;
      content: unknown;
      speakers: Array<{ id: string; label: string; talk_time_sec: number; word_count: number }>;
      speaker_names: unknown;
    }>
  >`SELECT raw_text, content, speakers, speaker_names FROM transcripts WHERE meeting_id = ${id}`;

  const [summaryRow] = await sql<
    Array<{
      executive: string | null;
      key_topics: unknown;
      decisions: unknown;
      open_questions: unknown;
      chapters: unknown;
    }>
  >`SELECT executive, key_topics, decisions, open_questions, chapters
    FROM summaries WHERE meeting_id = ${id}`;

  const transcript = transcriptRow ? buildTranscriptResponse(transcriptRow) : null;
  const summary = summaryRow
    ? {
        executive: summaryRow.executive,
        key_topics: coerceJsonArray<string>(summaryRow.key_topics),
        decisions: coerceJsonArray<string>(summaryRow.decisions),
        open_questions: coerceJsonArray<string>(summaryRow.open_questions),
        chapters: coerceJsonArray<{
          title: string;
          start_sec: number;
          end_sec: number;
          summary: string;
        }>(summaryRow.chapters),
      }
    : null;

  // Source-of-truth flags so the client can render the right processing
  // steps without leaking the underlying audio_key / transcripts.provider.
  const hasAudio = meeting.audio_key !== null && meeting.audio_key !== "";
  // `transcripts.provider` is 'user' for paste-uploads, 'assemblyai-streaming'
  // for live recordings — both mean the client supplied the transcript and
  // the worker should skip transcription. We surface this so the processing
  // UI can hide the "Transcribed" step.
  const transcriptProvider = transcriptRow
    ? await sql<Array<{ provider: string }>>`
        SELECT provider FROM transcripts WHERE meeting_id = ${id} LIMIT 1
      `.then((r) => r[0]?.provider ?? null)
    : null;
  const transcriptProvided =
    transcriptProvider === "user" || transcriptProvider === "assemblyai-streaming";

  return c.json({
    ...meeting,
    has_audio: hasAudio,
    transcript_provided: transcriptProvided,
    meeting_score: coerceJsonObject<Record<string, unknown>>(meeting.meeting_score),
    transcript,
    summary,
  });
});

// Older rows were inserted with sql.json(), which double-encodes — reads come
// back as JSON-encoded strings instead of arrays/objects. Normalize both.
function coerceJsonArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function coerceJsonObject<T>(value: unknown): T | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as T;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as T) : null;
    } catch {
      return null;
    }
  }
  return null;
}

interface WordEntry {
  word: string;
  start: number;
  end: number;
  speaker?: string | null;
}

interface SegmentOut {
  speaker: string | null;
  start_sec: number;
  end_sec: number;
  text: string;
}

/**
 * Resolve a raw diarization label ("A") to what the user should read.
 *
 * Falls back to "Speaker A" when nobody has named that voice yet — never the
 * bare letter, which is what the transcript used to render.
 */
function displaySpeaker(raw: string | null, names: Record<string, string>): string | null {
  if (!raw) return null;
  const named = names[raw];
  return named && named.trim() ? named : `Speaker ${raw}`;
}

/** `speaker_names` is JSONB and, like the other JSONB columns here, may arrive double-encoded. */
function parseSpeakerNames(value: unknown): Record<string, string> {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return out;
}

function buildTranscriptResponse(row: {
  raw_text: string;
  content: unknown;
  speakers: Array<{ id: string; label: string; talk_time_sec: number; word_count: number }>;
  speaker_names?: unknown;
}): { raw_text: string; segments: SegmentOut[]; speakers: typeof row.speakers } {
  // `content` may be a real JSONB object OR a JSON-encoded string (older
  // meetings inserted before the sql.json fix). Normalize both forms.
  let content: {
    words?: WordEntry[];
    paragraphs?: Array<{ start: number; end: number; speaker?: string | null; text: string }>;
  } = {};
  try {
    if (typeof row.content === "string") content = JSON.parse(row.content) as typeof content;
    else if (row.content && typeof row.content === "object")
      content = row.content as typeof content;
  } catch {
    /* leave content empty — segments will be empty too */
  }

  const segments: SegmentOut[] = [];

  // Prefer paragraphs if present (cleaner segmentation).
  if (Array.isArray(content.paragraphs) && content.paragraphs.length > 0) {
    for (const p of content.paragraphs) {
      segments.push({
        speaker: p.speaker ?? null,
        start_sec: Math.floor(p.start),
        end_sec: Math.ceil(p.end),
        text: p.text,
      });
    }
  } else if (Array.isArray(content.words) && content.words.length > 0) {
    // Group consecutive words by speaker into segments.
    let cur: { speaker: string | null; words: WordEntry[] } | null = null;
    for (const w of content.words) {
      const sp = w.speaker ?? null;
      if (!cur || cur.speaker !== sp) {
        if (cur) segments.push(toSegment(cur));
        cur = { speaker: sp, words: [w] };
      } else {
        cur.words.push(w);
      }
    }
    if (cur) segments.push(toSegment(cur));
  } else if (row.raw_text) {
    // Fallback for transcript-only uploads with no word-level data.
    segments.push({ speaker: null, start_sec: 0, end_sec: 0, text: row.raw_text });
  }

  // `speakers` has the same double-encoding problem as `content` above and was
  // NOT being normalized — it went out as a JSON string, so the UI rendered
  // `speakers.length` as the string's character count (149 instead of 2) and
  // the response violated its own Zod contract (schemas.ts declares an array).
  let speakers: typeof row.speakers = [];
  try {
    if (typeof row.speakers === "string") speakers = JSON.parse(row.speakers) as typeof speakers;
    else if (Array.isArray(row.speakers)) speakers = row.speakers;
  } catch {
    /* malformed — fall back to no speakers rather than failing the request */
  }
  if (!Array.isArray(speakers)) speakers = [];

  // Apply human names over the raw diarization labels. `id` is normalised to
  // the RAW label ("A") because that's what segments carry and what the rename
  // endpoint addresses — the stored form was "speaker_A", which matched
  // neither.
  const names = parseSpeakerNames(row.speaker_names);
  speakers = speakers.map((s) => {
    const raw = s.id?.startsWith("speaker_") ? s.id.slice("speaker_".length) : s.id;
    return { ...s, id: raw, label: displaySpeaker(raw, names) ?? s.label };
  });
  for (const seg of segments) seg.speaker = displaySpeaker(seg.speaker, names);

  return { raw_text: row.raw_text, segments, speakers };
}

function toSegment(group: { speaker: string | null; words: WordEntry[] }): SegmentOut {
  return {
    speaker: group.speaker,
    start_sec: Math.floor(group.words[0].start),
    end_sec: Math.ceil(group.words[group.words.length - 1].end),
    text: group.words.map((w) => w.word).join(" "),
  };
}

// ---------------------------------------------------------------------------
// PATCH /:id — update title/tags/visibility
// ---------------------------------------------------------------------------
app.patch("/:id", zValidator("json", MeetingPatchRequest), async (c) => {
  const id = c.req.param("id");
  const patch = c.req.valid("json");
  const user = c.get("user");
  const workspaceId = c.get("workspaceId");
  const sql = getSql();

  const sets = [];
  if (patch.title !== undefined) sets.push(sql`title = ${patch.title}`);
  if (patch.tags !== undefined) sets.push(sql`tags = ${sql.array(patch.tags)}`);
  if (patch.visibility !== undefined) sets.push(sql`visibility = ${patch.visibility}`);

  if (sets.length === 0) return c.json({ ok: true });

  const setClause = sets.reduce((acc, cur, i) => (i === 0 ? cur : sql`${acc}, ${cur}`));

  await sql`UPDATE meetings SET ${setClause} WHERE id = ${id} AND user_id = ${user.id} AND workspace_id = ${workspaceId}`;
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// PATCH /:id/speakers — put human names on diarized voices
// ---------------------------------------------------------------------------
app.patch("/:id/speakers", zValidator("json", SpeakerNamesRequest), async (c) => {
  const id = c.req.param("id");
  const { names } = c.req.valid("json");
  const user = c.get("user");
  const workspaceId = c.get("workspaceId");
  const sql = getSql();

  // Scope the write through meetings so a user can't rename speakers on a
  // transcript in someone else's workspace — transcripts has no user_id.
  const owned = await sql<Array<{ id: string }>>`
    SELECT id FROM meetings
    WHERE id = ${id} AND user_id = ${user.id} AND workspace_id = ${workspaceId}
  `;
  if (owned.length === 0) throw new HTTPException(404, { message: "Meeting not found" });

  // Blank means "clear this name" — drop the key so the label falls back to
  // "Speaker A" rather than persisting an empty string.
  const cleaned: Record<string, string> = {};
  for (const [raw, name] of Object.entries(names)) {
    const trimmed = name.trim();
    if (trimmed) cleaned[raw] = trimmed;
  }

  const updated = await sql<Array<{ meeting_id: string }>>`
    UPDATE transcripts
    SET speaker_names = ${JSON.stringify(cleaned)}::jsonb
    WHERE meeting_id = ${id}
    RETURNING meeting_id
  `;
  if (updated.length === 0) {
    throw new HTTPException(404, { message: "This meeting has no transcript yet" });
  }

  return c.json({ ok: true, names: cleaned });
});

// ---------------------------------------------------------------------------
// DELETE /:id
// ---------------------------------------------------------------------------
app.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const workspaceId = c.get("workspaceId");
  const sql = getSql();

  const rows = await sql<
    Array<{ audio_key: string | null }>
  >`SELECT audio_key FROM meetings WHERE id = ${id} AND user_id = ${user.id} AND workspace_id = ${workspaceId}`;
  const row = rows[0];
  if (!row) throw new HTTPException(404, { message: "Meeting not found" });

  if (row.audio_key) {
    await deleteAudioObject(row.audio_key).catch((e) => console.error("[r2-delete]", e));
  }
  await sql`DELETE FROM meetings WHERE id = ${id} AND user_id = ${user.id} AND workspace_id = ${workspaceId}`;
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// GET /:id/status — polling
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// GET /:id/audio-url — short-lived signed URL to stream/play the audio
// ---------------------------------------------------------------------------
app.get("/:id/audio-url", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const workspaceId = c.get("workspaceId");
  const sql = getSql();
  const rows = await sql<Array<{ audio_key: string | null; audio_mime: string | null }>>`
    SELECT audio_key, audio_mime FROM meetings WHERE id = ${id} AND user_id = ${user.id} AND workspace_id = ${workspaceId}
  `;
  const meeting = rows[0];
  if (!meeting) throw new HTTPException(404, { message: "Meeting not found" });
  if (!meeting.audio_key) throw new HTTPException(404, { message: "No audio for this meeting" });

  const ttl = 30 * 60;
  const url = await createSignedReadUrl(meeting.audio_key, ttl);
  return c.json({
    url,
    mime: meeting.audio_mime,
    expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
  });
});

app.get("/:id/status", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const workspaceId = c.get("workspaceId");
  const sql = getSql();

  const rows = await sql<
    Array<{
      id: string;
      status: MeetingRow["status"];
      failure_reason: string | null;
      duration_sec: number | null;
      audio_key: string | null;
    }>
  >`
    SELECT id, status, failure_reason, duration_sec, audio_key
    FROM meetings WHERE id = ${id} AND user_id = ${user.id} AND workspace_id = ${workspaceId}
  `;
  const data = rows[0];
  if (!data) throw new HTTPException(404, { message: "Meeting not found" });

  const progress = {
    uploaded: data.audio_key !== null,
    transcribed: ["analyzing", "indexing", "complete"].includes(data.status),
    analyzed: ["indexing", "complete"].includes(data.status),
    indexed: data.status === "complete",
  };

  const estimated =
    data.status === "complete"
      ? 0
      : data.duration_sec
        ? Math.max(30, Math.floor(data.duration_sec / 20))
        : null;

  return c.json(
    MeetingStatusResponse.parse({
      id: data.id,
      status: data.status,
      progress,
      estimated_seconds_remaining: estimated,
      failure_reason: data.failure_reason,
    }),
  );
});

// ---------------------------------------------------------------------------
// POST /:id/retry
// ---------------------------------------------------------------------------
app.post("/:id/retry", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const workspaceId = c.get("workspaceId");
  const sql = getSql();

  const rows = await sql<MeetingRow[]>`
    SELECT id, user_id, audio_key, language, status, retry_count
    FROM meetings WHERE id = ${id} AND user_id = ${user.id} AND workspace_id = ${workspaceId}
  `;
  const meeting = rows[0];
  if (!meeting) throw new HTTPException(404, { message: "Meeting not found" });
  if (meeting.status !== "failed") {
    throw new HTTPException(400, { message: "Meeting is not in a failed state" });
  }
  if (meeting.retry_count >= 3) {
    throw new HTTPException(400, { message: "Maximum retries reached" });
  }
  if (!meeting.audio_key) {
    throw new HTTPException(400, { message: "Audio file no longer available" });
  }

  await sql`UPDATE meetings SET status = 'queued', failure_reason = NULL WHERE id = ${id}`;

  // Must clear the retained failed job first — see reenqueueProcessingJob.
  const queued = await reenqueueProcessingJob({
    meeting_id: meeting.id,
    user_id: meeting.user_id,
    audio_key: meeting.audio_key,
    language: meeting.language,
    retry_count: meeting.retry_count + 1,
  });

  if (!queued) {
    // A worker holds the lock — this meeting is already being reprocessed.
    // Leave the status as 'queued' (set above); the worker owning the lock
    // advances it. Do NOT write 'processing' here — it is absent from the
    // meetings.status CHECK constraint, so the write throws before the 409
    // below is constructed, surfacing a 500 and stranding the meeting in
    // 'queued' with no job and no path back to 'failed' to retry from.
    throw new HTTPException(409, { message: "This meeting is already being processed" });
  }

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
  const workspaceId = c.get("workspaceId");
  const sql = getSql();

  // 128 bits from a CSPRNG. Guessing is not a threat model at this width; the
  // share bucket in the rate limiter covers the unauthenticated read side.
  const share_token = enabled ? randomBytes(16).toString("hex") : null;

  // RETURNING, not a bare UPDATE: without it the endpoint happily handed back a
  // freshly-minted share_url for a meeting id the caller doesn't own — the row
  // was never written, but the response said otherwise.
  const updated = await sql<Array<{ id: string }>>`
    UPDATE meetings SET share_token = ${share_token}
    WHERE id = ${id} AND user_id = ${user.id} AND workspace_id = ${workspaceId}
    RETURNING id
  `;
  if (updated.length === 0) throw new HTTPException(404, { message: "Meeting not found" });

  const env = await import("../../env").then((m) => m.getEnv());
  return c.json({
    share_token,
    share_url: share_token ? `${env.APP_URL}/share/${share_token}` : null,
  });
});

export default app;
