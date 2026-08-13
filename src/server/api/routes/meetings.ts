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
  ConcatenableMime,
  SegmentedRecordingRequest,
  SegmentedRecordingResponse,
  SegmentUploadUrlRequest,
  SegmentUploadUrlResponse,
  SegmentRegisterRequest,
  SegmentRegisterResponse,
  SegmentCompleteRequest,
  SegmentCompleteResponse,
  SegmentGapError,
  SEGMENT_TARGET_SECONDS,
  MAX_SEGMENT_BYTES,
} from "../../../lib/schemas";
import {
  buildAudioKey,
  buildSegmentAudioKey,
  extensionFromMime,
  createPresignedUploadUrl,
  createSignedReadUrl,
  deleteAudioObject,
  deleteAudioObjects,
  headAudioObject,
  readObjectPrefix,
} from "../../services/r2";
import { enqueueProcessingJob, reenqueueProcessingJob } from "../../services/queue";
import { getSql } from "../../db";
import type { MeetingRow } from "../../db/types";
import type { NotableMoment } from "../../lib/moments";

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

/** Escape LIKE/ILIKE wildcards so user search text matches literally. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * True when a search string carries at least one term to match ON, rather than
 * only terms to exclude.
 *
 * websearch_to_tsquery turns `-budget` into `!'budget'`, a query that matches
 * every document NOT containing the word. GIN cannot seek on a pure negation,
 * so it answers by scanning the whole index and letting the recheck throw rows
 * away — across every tenant's transcripts, for a query that by definition
 * cannot be selective. One-character input like `-` is all it takes.
 *
 * When nothing positive is left we skip the tsquery branches entirely and fall
 * back to the title match, which is exactly what this endpoint did before
 * full-text search existed. Users get a defensible result and the database
 * never gets asked the unanswerable question.
 */
export function hasPositiveSearchTerm(value: string): boolean {
  const withoutExclusions = value
    // -"quoted phrase" first, so its inner words aren't counted as positive.
    .replace(/-"[^"]*"/g, " ")
    // \S* not \S+: a bare "-" is punctuation, not something to match on.
    .replace(/(^|\s)-\S*/g, " ");
  return /\S/.test(withoutExclusions);
}

/**
 * ts_headline options for a match excerpt.
 *
 * MaxFragments=1 keeps it to a single run of text. The [[...]] markers around
 * matched lexemes are plain text on purpose — this response feeds a React
 * Native list, and shipping HTML into it would be someone else's XSS problem.
 */
const HEADLINE_OPTS = "StartSel=[[,StopSel=]],MaxFragments=1,MaxWords=24,MinWords=10,ShortWord=2";

/**
 * How much transcript ts_headline is allowed to read.
 *
 * ts_headline re-parses the document it is given; on a full 70KB transcript
 * that measured ~10ms, and this runs once per row on the page. Capping the
 * input to the first ~16K characters costs ~3ms instead. The trade is that a
 * term appearing ONLY past that point yields a leading excerpt without the
 * highlight rather than no row at all — the row still matched, because
 * matching is decided by the GIN index over the whole (500K-capped) vector.
 */
const HEADLINE_SOURCE_CHARS = 16000;

/** Hard cap on the excerpt returned to the client. */
const SNIPPET_MAX_CHARS = 240;

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
// Segmented recording
//
// The client rotates its recorder into a fresh file every ~60s and uploads
// each closed segment immediately, so a crash costs one segment instead of the
// whole meeting. Four calls: open the recording, presign a segment, register
// it once it lands, close the recording.
//
// The meeting row is created up front because segments need something to hang
// off, but its audio_key stays NULL until the worker joins them. That is what
// keeps every existing reader honest while a recording is in flight:
// /:id/status reports uploaded:false, /:id/audio-url 404s instead of signing a
// URL for an object that does not exist, and the retention sweep (which only
// considers rows with an audio_key) leaves it alone.
// ---------------------------------------------------------------------------

/**
 * Load a meeting for a segment operation, or 404.
 *
 * Every segment endpoint needs the same three things: proof the caller owns
 * the meeting, the container the recording was opened with, and whether the
 * join has already happened. Scoped by user_id AND workspace_id — there is no
 * RLS, and these endpoints mint and return object keys.
 */
async function loadSegmentTarget(
  meetingId: string,
  userId: string,
  workspaceId: string,
): Promise<{ audio_key: string | null; audio_mime: string | null; language: string }> {
  const sql = getSql();
  const rows = await sql<
    Array<{ audio_key: string | null; audio_mime: string | null; language: string }>
  >`
    SELECT audio_key, audio_mime, language
    FROM meetings
    WHERE id = ${meetingId} AND user_id = ${userId} AND workspace_id = ${workspaceId}
  `;
  const meeting = rows[0];
  if (!meeting) throw new HTTPException(404, { message: "Meeting not found" });
  return meeting;
}

/**
 * Reject a meeting that cannot take (more) segments.
 *
 * Two distinct refusals. A non-concatenable container must never accumulate
 * segments, because joining them would silently drop all but the first — see
 * ConcatenableMime; failing at registration is the difference between a clear
 * 400 during development and a production transcript that is quietly missing
 * an hour. A meeting that already has an audio_key has been joined, and a
 * segment arriving after that would be stored, paid for, and never read.
 */
function assertAcceptsSegments(meeting: {
  audio_key: string | null;
  audio_mime: string | null;
}): ConcatenableMime {
  if (meeting.audio_key) {
    throw new HTTPException(409, {
      message: "This recording has already been assembled and cannot take more segments",
    });
  }
  const parsed = ConcatenableMime.safeParse(meeting.audio_mime);
  if (!parsed.success) {
    throw new HTTPException(400, {
      message: `Segmented recording requires a byte-concatenable container (${ConcatenableMime.options.join(", ")}), not ${meeting.audio_mime ?? "an unset type"}`,
    });
  }
  return parsed.data;
}

// POST /segmented — open a segmented recording
app.post("/segmented", zValidator("json", SegmentedRecordingRequest), async (c) => {
  const body = c.req.valid("json");
  const user = c.get("user");
  const workspaceId = c.get("workspaceId");
  const sql = getSql();

  const meetingId = randomUUID();

  // audio_key and audio_size stay NULL until the join. duration_sec is unknown
  // until the recording stops, and status is 'queued' — the same state a
  // single-file upload sits in between /upload-url and the PUT completing, so
  // no client needs to learn a new status value to render this.
  await sql`
    INSERT INTO meetings (
      id, user_id, workspace_id, title, audio_mime, language, tags, status, recorded_at
    ) VALUES (
      ${meetingId},
      ${user.id},
      ${workspaceId},
      ${body.title ?? "Untitled recording"},
      ${body.content_type},
      ${body.language},
      ${sql.array(body.tags)},
      'queued',
      ${sanitizeRecordedAt(body.recorded_at)}
    )
  `;

  return c.json(
    SegmentedRecordingResponse.parse({
      meeting_id: meetingId,
      status: "queued",
      segment_target_seconds: SEGMENT_TARGET_SECONDS,
      max_segment_bytes: MAX_SEGMENT_BYTES,
    }),
  );
});

// POST /:id/segments/upload-url — presign one segment
app.post("/:id/segments/upload-url", zValidator("json", SegmentUploadUrlRequest), async (c) => {
  const id = c.req.param("id");
  const body = c.req.valid("json");
  const user = c.get("user");
  const workspaceId = c.get("workspaceId");

  const meeting = await loadSegmentTarget(id, user.id, workspaceId);
  const mime = assertAcceptsSegments(meeting);

  // Minted here, never accepted from the client. Unlike /from-live — which
  // takes an audio_key and has to police it with assertOwnedAudioKey — there
  // is no way for a caller to point this at another tenant's prefix.
  const audioKey = buildSegmentAudioKey(user.id, id, body.index, extensionFromMime(mime));

  // Signed WITH the content length, so R2 rejects a body of any other size.
  // A truncated upload therefore fails at the bucket instead of registering
  // as a short segment and clipping the meeting.
  const { upload_url, expires_at } = await createPresignedUploadUrl(audioKey, mime, body.size);

  return c.json(
    SegmentUploadUrlResponse.parse({
      index: body.index,
      upload_url,
      audio_key: audioKey,
      expires_at,
    }),
  );
});

// POST /:id/segments — register a segment that finished uploading
app.post("/:id/segments", zValidator("json", SegmentRegisterRequest), async (c) => {
  const id = c.req.param("id");
  const { index } = c.req.valid("json");
  const user = c.get("user");
  const workspaceId = c.get("workspaceId");
  const sql = getSql();

  const meeting = await loadSegmentTarget(id, user.id, workspaceId);
  const mime = assertAcceptsSegments(meeting);

  const audioKey = buildSegmentAudioKey(user.id, id, index, extensionFromMime(mime));

  /**
   * Confirm the object with the bucket before recording that it exists.
   *
   * The client saying "segment 4 is uploaded" is a claim, not evidence; a PUT
   * that failed on a flaky connection looks identical from up here. Taking the
   * size from the HeadObject response rather than the request body makes the
   * row a statement about R2 rather than about the client, which is what lets
   * the join trust SUM(bytes) as its Content-Length.
   */
  const head = await headAudioObject(audioKey);
  if (!head) {
    throw new HTTPException(409, {
      message: `Segment ${index} is not in storage — upload it before registering it`,
    });
  }

  /**
   * Look at the bytes, not just the label.
   *
   * Everything up to here has trusted a MIME the CLIENT declared: /segmented
   * pinned it onto the meeting, and assertAcceptsSegments re-checks that same
   * stored value. A client that declares audio/aac and uploads MPEG-4 passed
   * every check — and that is the one mistake this system cannot survive
   * quietly, because concatenated MPEG-4 comes back from AssemblyAI as
   * `status: completed`, `error: null`, with a transcript containing only the
   * first segment. The rest of the meeting is gone and nothing reports it.
   *
   * ADTS frames start with a 12-bit sync word: 0xFF followed by 0xF0-0xFF.
   * MPEG-4 carries `ftyp` at offset 4. Checking here rather than at the join is
   * deliberate — the client is still on the call and can be told which segment
   * was wrong, whereas a failure at finalize arrives after the recording is
   * over and there is nothing left to re-capture.
   *
   * Best-effort by design: a null prefix means the ranged read failed, not that
   * the audio is bad, and the HeadObject above has already proven the object is
   * there. Refusing to register a good segment because a GET blipped would lose
   * exactly the audio this check exists to protect.
   */
  if (mime === "audio/aac") {
    const prefix = await readObjectPrefix(audioKey);
    if (prefix && prefix.length >= 2) {
      const isAdts = prefix[0] === 0xff && (prefix[1] & 0xf0) === 0xf0;
      if (!isAdts) {
        const looksMp4 = prefix.length >= 8 && prefix.subarray(4, 8).toString("ascii") === "ftyp";
        throw new HTTPException(422, {
          message: looksMp4
            ? `Segment ${index} is an MPEG-4 file declared as ADTS AAC. MPEG-4 segments cannot be joined — everything after the first one would be silently dropped. Record with ios.extension ".aac" / outputFormat "aac_adts".`
            : `Segment ${index} is not ADTS AAC (starts 0x${prefix.subarray(0, 2).toString("hex")}). Segmented recording requires ADTS, which is the only container that concatenates losslessly.`,
        });
      }
    }
  }

  // Upsert, not insert: a register retried after a timeout must not 409 on a
  // segment that already landed, and re-uploading a segment legitimately
  // changes its size.
  await sql`
    INSERT INTO meeting_segments (meeting_id, user_id, workspace_id, "index", audio_key, bytes)
    VALUES (${id}, ${user.id}, ${workspaceId}, ${index}, ${audioKey}, ${head.bytes})
    ON CONFLICT (meeting_id, "index") DO UPDATE SET
      audio_key = EXCLUDED.audio_key,
      bytes = EXCLUDED.bytes
  `;

  const [{ registered_count }] = await sql<[{ registered_count: number }]>`
    SELECT COUNT(*)::int AS registered_count
    FROM meeting_segments
    WHERE meeting_id = ${id} AND user_id = ${user.id} AND workspace_id = ${workspaceId}
  `;

  return c.json(SegmentRegisterResponse.parse({ index, bytes: head.bytes, registered_count }));
});

// POST /:id/segments/complete — close the recording and queue it
app.post("/:id/segments/complete", zValidator("json", SegmentCompleteRequest), async (c) => {
  const id = c.req.param("id");
  const body = c.req.valid("json");
  const user = c.get("user");
  const workspaceId = c.get("workspaceId");
  const sql = getSql();

  const meeting = await loadSegmentTarget(id, user.id, workspaceId);

  // Idempotent: a client that retried complete after the response was lost
  // gets the same answer instead of a second job. enqueueProcessingJob dedupes
  // on meeting id too, but answering here avoids re-running the gap check
  // against a meeting whose segment rows have already been consumed.
  if (meeting.audio_key) {
    const [{ segment_count, total_bytes }] = await sql<
      [{ segment_count: number; total_bytes: string }]
    >`
      SELECT COUNT(*)::int AS segment_count, COALESCE(SUM(bytes), 0)::bigint AS total_bytes
      FROM meeting_segments
      WHERE meeting_id = ${id} AND user_id = ${user.id} AND workspace_id = ${workspaceId}
    `;
    return c.json(
      SegmentCompleteResponse.parse({
        meeting_id: id,
        status: "queued",
        segment_count,
        total_bytes: Number(total_bytes),
      }),
    );
  }

  const mime = assertAcceptsSegments(meeting);

  // bytes is BIGINT and arrives as a string — see MeetingSegmentRow.bytes.
  const segments = await sql<Array<{ index: number; bytes: string }>>`
    SELECT "index", bytes
    FROM meeting_segments
    WHERE meeting_id = ${id} AND user_id = ${user.id} AND workspace_id = ${workspaceId}
    ORDER BY "index" ASC
  `;

  if (segments.length === 0) {
    throw new HTTPException(400, {
      message: "No segments were registered for this recording",
    });
  }

  /**
   * The gap check.
   *
   * `total_segments` is what separates "the recording was six segments long"
   * from "segments six and seven never made it". Without it, a meeting whose
   * last two uploads failed looks contiguous and would be transcribed two
   * minutes short with nothing to indicate anything was lost. When the client
   * cannot supply it — recovering a recording whose own count died with the
   * process — max(index)+1 is the best available answer and still catches
   * every hole in the middle, just not a missing tail.
   */
  const expectedTotal = body.total_segments ?? segments[segments.length - 1].index + 1;
  const present = new Set(segments.map((s) => s.index));
  const missing: number[] = [];
  for (let i = 0; i < expectedTotal; i++) {
    if (!present.has(i)) missing.push(i);
  }

  /**
   * A registered index at or beyond the declared total.
   *
   * Checking only for holes below `total_segments` would pass a recording that
   * declared 3 segments but registered 0, 1, 2 and 5 — the set has no gap in
   * the range examined, yet the join would splice in a stray segment 5 and the
   * meeting would contain a minute of audio from somewhere the client did not
   * think it sent. Not a gap the client can fix by re-uploading, so it does not
   * get the recoverable error shape.
   */
  const unexpected = segments.filter((s) => s.index >= expectedTotal).map((s) => s.index);
  if (unexpected.length > 0) {
    throw new HTTPException(409, {
      message: `Segment(s) ${unexpected.join(", ")} are outside the declared total of ${expectedTotal}`,
    });
  }

  if (missing.length > 0) {
    // A custom response, not a bare message: the client's recovery path is to
    // re-upload precisely these indexes and call complete again, and it cannot
    // do that from prose. errorHandler passes `res` through untouched.
    throw new HTTPException(409, {
      res: c.json(
        SegmentGapError.parse({
          error: "incomplete_segments",
          message: `Missing segment(s) ${missing.join(", ")} of ${expectedTotal}. Re-upload them and call complete again.`,
          missing,
          expected_total: expectedTotal,
        }),
        409,
      ),
    });
  }

  const totalBytes = segments.reduce((sum, s) => sum + Number(s.bytes), 0);

  // duration_sec is the client's wall-clock figure so the status endpoint can
  // estimate progress before transcription runs; the worker overwrites it with
  // AssemblyAI's measured duration.
  if (body.duration_sec !== undefined) {
    await sql`
      UPDATE meetings SET duration_sec = ${body.duration_sec}
      WHERE id = ${id} AND user_id = ${user.id} AND workspace_id = ${workspaceId}
    `;
  }

  // The key the worker will write the joined object to. The worker derives it
  // independently and ignores this field whenever segments exist, so it is
  // belt-and-braces: it keeps the job payload meaningful for anything that
  // inspects the queue, and it is the key a retry falls back to once the
  // meeting has been joined and looks like any other single-file upload.
  await enqueueProcessingJob({
    meeting_id: id,
    user_id: user.id,
    audio_key: buildAudioKey(user.id, id, extensionFromMime(mime)),
    language: meeting.language,
    retry_count: 0,
  });

  return c.json(
    SegmentCompleteResponse.parse({
      meeting_id: id,
      status: "queued",
      segment_count: segments.length,
      total_bytes: totalBytes,
    }),
  );
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

  // ------------------------------------------------------------------
  // Search
  //
  // People search for what was SAID, not for the title they typed weeks
  // ago — "R2 credentials" has to find the meeting where someone said it.
  // The stored tsvectors (0014) carry title at weight A, summary at B and
  // transcript at D; this query concatenates them at read time, which
  // preserves per-lexeme weights, and ranks the result with ts_rank_cd.
  //
  // websearch_to_tsquery, not to_tsquery or plainto_tsquery: it hands users
  // "quoted phrases" and -exclusions for free, and it never raises. to_tsquery
  // answers `foo & | bar` with a syntax error, which is a 500 served to a user
  // whose only crime was a typo.
  // ------------------------------------------------------------------
  const searchText = q.q; // zod: trimmed, <= 200 chars
  // Escape LIKE metacharacters: an unescaped '%' turns every search into a full
  // table scan of the user's meetings, and '_' silently widens matches.
  const likePattern = searchText ? `%${escapeLike(searchText)}%` : "";
  const useFts = searchText !== undefined && hasPositiveSearchTerm(searchText);
  // Interpolated as a bound parameter by postgres.js, never as SQL text —
  // transcripts and search boxes are untrusted input and sql.unsafe() is not
  // in this file for a reason.
  const tsQuery = sql`websearch_to_tsquery('english', ${searchText ?? ""})`;

  // Build dynamic conditions via postgres.js helper composability.
  const conditions = [sql`m.user_id = ${user.id}`, sql`m.workspace_id = ${workspaceId}`];
  if (q.status) conditions.push(sql`m.status = ${q.status}`);
  if (q.tag) conditions.push(sql`${q.tag} = ANY(m.tags)`);
  if (q.from) conditions.push(sql`m.created_at >= ${q.from}`);
  if (q.to) conditions.push(sql`m.created_at <= ${q.to}`);

  if (searchText) {
    // One index-driven branch per place text lives, UNIONed into an id set,
    // rather than OR-ing across LEFT JOINs. An OR spanning three tables cannot
    // use any of the three GIN indexes: Postgres would walk every transcript
    // the user owns and detoast each vector, so search would get slower with
    // every meeting they record. Each branch here can be answered by an index.
    //
    // Tenant scoping lives on the OUTER query (m.user_id / m.workspace_id, ANDed
    // with this id set), which is what makes the result safe. The summary and
    // transcript branches deliberately do NOT re-join meetings to re-check the
    // owner: an earlier revision did, and it cost 100x. Adding the join let the
    // planner hash-join instead of seeking, and a "cheap" Seq Scan on
    // transcripts — cheap in its model because raw_text and search_tsv are both
    // TOASTed out of the main heap, so the planner never charges for
    // detoasting — took 317ms against 3ms for the plan that uses the GIN index
    // (15k meetings, 376MB of transcripts, measured). Ids from another tenant
    // can appear in this set; not one of them can survive the outer WHERE.
    const branches = [
      // Substring on title: FTS matches whole stemmed words only, so without
      // this, typing "roadm" would stop finding "Roadmap review" — a
      // regression against the behaviour this endpoint shipped with.
      sql`
        SELECT sm.id FROM meetings sm
         WHERE sm.user_id = ${user.id} AND sm.workspace_id = ${workspaceId}
           AND sm.title ILIKE ${likePattern} ESCAPE '\\'`,
    ];
    if (useFts) {
      branches.push(
        sql`
        SELECT sm.id FROM meetings sm
         WHERE sm.user_id = ${user.id} AND sm.workspace_id = ${workspaceId}
           AND sm.search_tsv @@ ${tsQuery}`,
        sql`
        SELECT ss.meeting_id FROM summaries ss
         WHERE ss.search_tsv @@ ${tsQuery}`,
        sql`
        SELECT st.meeting_id FROM transcripts st
         WHERE st.search_tsv @@ ${tsQuery}`,
      );
    }
    const matchedIds = branches.reduce((acc, cur, i) => (i === 0 ? cur : sql`${acc} UNION ${cur}`));
    conditions.push(sql`m.id IN (${matchedIds})`);
  }

  const whereClause = conditions.reduce((acc, cur, i) => (i === 0 ? cur : sql`${acc} AND ${cur}`));

  // Ranking.
  //
  // A title hit sorts above every body hit, unconditionally. setweight() alone
  // does not deliver that: ts_rank_cd sums cover densities, so a transcript
  // saying the word forty times at weight D scores 8.0 against a title's 1.0
  // (measured). Someone searching a meeting by its name would find it on page
  // three. Weights still order everything below that first key.
  const ftsTitleHit = useFts ? sql` OR m.search_tsv @@ ${tsQuery}` : sql``;
  const titleHit = sql`(m.title ILIKE ${likePattern} ESCAPE '\\'${ftsTitleHit})`;
  const rankExpr = useFts
    ? sql`ts_rank_cd(
        m.search_tsv
          || COALESCE(s.search_tsv, ''::tsvector)
          || COALESCE(t.search_tsv, ''::tsvector),
        ${tsQuery})`
    : sql`0::float4`;
  // Joined only when ranking needs it. Without a query this join would be
  // dead weight on the recency listing, which is the hot path.
  const searchJoin = useFts ? sql`LEFT JOIN transcripts t ON t.meeting_id = m.id` : sql``;
  // Recency order is preserved exactly when there is no query: without a
  // search, title_hit is FALSE and rank is 0 for every row, so the sort
  // collapses to created_at DESC — the ordering this endpoint always had.
  const titleHitSelect = searchText ? titleHit : sql`FALSE`;
  const orderClause = searchText
    ? sql`${titleHit} DESC, ${rankExpr} DESC, m.created_at DESC`
    : sql`m.created_at DESC`;

  // The excerpt that tells the user WHY this meeting matched. Computed in the
  // outer SELECT, over the page CTE, so ts_headline runs on the <=limit rows
  // being returned instead of on every row the ORDER BY had to consider.
  const snippetExpr = useFts
    ? sql`COALESCE(
        (SELECT left(ts_headline('english', left(st.raw_text, ${HEADLINE_SOURCE_CHARS}),
                                 ${tsQuery}, ${HEADLINE_OPTS}), ${SNIPPET_MAX_CHARS})
           FROM transcripts st
          WHERE st.meeting_id = p.id AND st.search_tsv @@ ${tsQuery}),
        (SELECT left(ts_headline('english', COALESCE(ss.executive, ''),
                                 ${tsQuery}, ${HEADLINE_OPTS}), ${SNIPPET_MAX_CHARS})
           FROM summaries ss
          WHERE ss.meeting_id = p.id AND ss.search_tsv @@ ${tsQuery})
      )`
    : sql`NULL::text`;

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
      match_snippet: string | null;
    }>
  >`
    WITH page AS (
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
        -- Carried out of the CTE so the outer SELECT can re-apply the same
        -- order. A CTE's internal ORDER BY is not a promise about the order
        -- rows leave the outer query in.
        ${titleHitSelect} AS title_hit,
        ${rankExpr} AS rank
      FROM meetings m
      LEFT JOIN summaries s ON s.meeting_id = m.id
      ${searchJoin}
      WHERE ${whereClause}
      ORDER BY ${orderClause}
      LIMIT ${q.limit} OFFSET ${offset}
    )
    SELECT
      p.id,
      p.title,
      p.status,
      p.duration_sec,
      p.tags,
      p.created_at,
      p.recorded_at,
      p.processed_at,
      p.summary_excerpt,
      (SELECT COUNT(*)::int FROM action_items ai WHERE ai.meeting_id = p.id) AS action_item_count,
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
        WHERE t.meeting_id = p.id
      ), 0)::int AS participant_count,
      ${snippetExpr} AS match_snippet
    FROM page p
    ORDER BY p.title_hit DESC, p.rank DESC, p.created_at DESC
  `;

  const [{ total }] = await sql<[{ total: number }]>`
    SELECT COUNT(*)::int AS total FROM meetings m WHERE ${whereClause}
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
      /**
       * Why this meeting matched, when the match was in the body. NULL when
       * there is no query, or when only the title matched (self-evident).
       * Additive and optional — existing clients that don't know the field
       * keep working unchanged.
       */
      match_snippet: r.match_snippet ?? null,
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
      participants: unknown;
      notable_moments: unknown;
    }>
  >`SELECT executive, key_topics, decisions, open_questions, chapters, participants,
           notable_moments
    FROM summaries WHERE meeting_id = ${id}`;

  const transcript = transcriptRow ? buildTranscriptResponse(transcriptRow) : null;
  const summary = summaryRow
    ? {
        executive: summaryRow.executive,
        key_topics: coerceJsonArray<string>(summaryRow.key_topics),
        decisions: coerceJsonArray<string>(summaryRow.decisions),
        open_questions: coerceJsonArray<string>(summaryRow.open_questions),
        // Names the model heard someone introduce or be addressed by. The
        // client offers these when putting real names to diarized voices — it
        // is the one signal a transcript scan on the phone cannot reproduce,
        // because the model heard the conversation and the regex only sees the
        // words. Empty for rows analysed before migration 0017.
        participants: coerceJsonArray<string>(summaryRow.participants),
        chapters: coerceJsonArray<{
          title: string;
          start_sec: number;
          end_sec: number;
          summary: string;
        }>(summaryRow.chapters),
        // Moments the analyst flagged, each already checked against the
        // transcript before it was stored — the quote travels with the claim so
        // the reader can judge it rather than take our word for it. Empty for
        // rows analysed before migration 0020, and for most meetings since,
        // which is why the client skips the section rather than rendering it.
        notable_moments: coerceJsonArray<NotableMoment>(summaryRow.notable_moments),
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

  // RETURNING + a length check, so a PATCH against a meeting the caller does not
  // own answers 404 rather than 200. The ownership scope in the WHERE already
  // made the write safe — a cross-tenant id updated zero rows — but returning
  // {ok:true} for it was a lie of a different kind: it told the client an edit
  // succeeded when nothing changed, and it was the ONLY mutating meeting route
  // that did so. DELETE /:id, POST /:id/share and PATCH /:id/speakers all
  // 404 on a miss; this now matches them. Found by an authorized pen-test.
  const updated = await sql<Array<{ id: string }>>`
    UPDATE meetings SET ${setClause}
    WHERE id = ${id} AND user_id = ${user.id} AND workspace_id = ${workspaceId}
    RETURNING id
  `;
  if (updated.length === 0) throw new HTTPException(404, { message: "Meeting not found" });

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

  /**
   * Segments too, before the rows go.
   *
   * A recording deleted mid-capture — or one whose join has not run yet — has
   * all of its audio in segment objects and none of it under audio_key, so the
   * delete above frees nothing. The rows are the only record of those keys and
   * they cascade away with the meeting, so reading them here is the last
   * chance: miss it and the user's audio stays in the bucket permanently,
   * unreachable by them and by the retention sweep. Already-joined meetings
   * hit this too and delete keys that are already gone, which is a no-op.
   */
  const segments = await sql<Array<{ audio_key: string }>>`
    SELECT audio_key FROM meeting_segments
    WHERE meeting_id = ${id} AND user_id = ${user.id} AND workspace_id = ${workspaceId}
  `;
  await deleteAudioObjects(segments.map((s) => s.audio_key));

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
    SELECT id, user_id, audio_key, audio_mime, language, status, retry_count
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

  /**
   * A segmented recording that failed BEFORE the join has no audio_key yet,
   * but its audio is all present in segment objects — so the bare audio_key
   * check would have refused to retry the one case most likely to need it (a
   * transient R2 error partway through the join). Fall back to the key the
   * join will write, which is what the worker resolves from the segment rows
   * anyway. Only a meeting with neither is genuinely unrecoverable.
   */
  let retryAudioKey = meeting.audio_key;
  if (!retryAudioKey) {
    const [segmented] = await sql<[{ has_segments: boolean }]>`
      SELECT EXISTS (
        SELECT 1 FROM meeting_segments
        WHERE meeting_id = ${id} AND user_id = ${user.id} AND workspace_id = ${workspaceId}
      ) AS has_segments
    `;
    if (segmented.has_segments) {
      retryAudioKey = buildAudioKey(user.id, id, extensionFromMime(meeting.audio_mime ?? ""));
    }
  }
  if (!retryAudioKey) {
    throw new HTTPException(400, { message: "Audio file no longer available" });
  }

  await sql`UPDATE meetings SET status = 'queued', failure_reason = NULL WHERE id = ${id}`;

  // Must clear the retained failed job first — see reenqueueProcessingJob.
  const queued = await reenqueueProcessingJob({
    meeting_id: meeting.id,
    user_id: meeting.user_id,
    audio_key: retryAudioKey,
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
