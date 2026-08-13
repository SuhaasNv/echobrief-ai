/**
 * Join a segmented recording back into one object, before transcription.
 *
 * WHY THIS RUNS BEFORE TRANSCRIPTION AND NOT INSTEAD OF IT
 *
 * The obvious cheaper design is to transcribe each segment as it lands, which
 * would also give progressive results. It is wrong here: AssemblyAI assigns
 * diarization labels per request, so "Speaker A" in segment 1 and "Speaker A"
 * in segment 7 are unrelated voices. Stitching those transcripts together
 * produces a meeting where everyone appears to swap identities every minute —
 * worse than the durability problem it set out to solve. Joining first keeps
 * diarization byte-identical to what single-file uploads have always produced.
 * Progressive transcription needs a speaker-reconciliation pass and is a
 * separate feature.
 *
 * WHY IT RUNS INSIDE THE PROCESSING JOB
 *
 * It is pure socket I/O — stream segments out of R2, stream one object back in
 * (see concatenateAudioObjects). No decode, no temp files, no CPU. There is
 * nothing synchronous to stall BullMQ lock renewal at concurrency 10, and no
 * memory spike, so it does not need a queue of its own. A separate stage would
 * buy nothing and would add a second place for a meeting to get stuck.
 */

import { getSql } from "../db";
import type { MeetingSegmentRow } from "../db/types";
import {
  audioObjectExists,
  buildAudioKey,
  concatenateAudioObjects,
  deleteAudioObjects,
  extensionFromMime,
} from "../services/r2";

/**
 * Ceiling on a joined recording, matching the 500MB cap UploadUrlRequest puts
 * on a single-file upload. Checked before the join rather than after: the join
 * is one streamed PUT with a declared Content-Length, so an oversized meeting
 * would be discovered by R2 rejecting the request halfway through a multi-
 * hundred-megabyte transfer.
 */
const MAX_JOINED_BYTES = 500 * 1024 * 1024;

/** Thrown with the specific indexes so the failure_reason names what is missing. */
class SegmentGapError extends Error {
  constructor(missing: number[], expectedTotal: number) {
    super(
      `Segmented recording is incomplete: missing segment(s) ${missing.join(", ")} of ${expectedTotal}. ` +
        `Refusing to transcribe a recording with a gap in it.`,
    );
    this.name = "SegmentGapError";
  }
}

/**
 * Resolve the audio key the pipeline should transcribe.
 *
 * Returns `fallbackAudioKey` untouched when the meeting has no segments, which
 * is every meeting uploaded as a single file — the whole feature is additive
 * and that path must not change.
 */
export async function materializeSegmentedAudio(
  meetingId: string,
  userId: string,
  workspaceId: string,
  fallbackAudioKey: string,
): Promise<string> {
  const sql = getSql();

  // Ordered by index, never by created_at: segments upload concurrently and a
  // retried upload routinely lands out of order. Scoped by all three columns
  // because there is no RLS here and this query returns object keys.
  const segments = await sql<Array<Pick<MeetingSegmentRow, "index" | "audio_key" | "bytes">>>`
    SELECT "index", audio_key, bytes
    FROM meeting_segments
    WHERE meeting_id = ${meetingId}
      AND user_id = ${userId}
      AND workspace_id = ${workspaceId}
    ORDER BY "index" ASC
  `;

  if (segments.length === 0) return fallbackAudioKey;

  const meetings = await sql<Array<{ audio_key: string | null; audio_mime: string | null }>>`
    SELECT audio_key, audio_mime
    FROM meetings
    WHERE id = ${meetingId} AND user_id = ${userId} AND workspace_id = ${workspaceId}
  `;
  const meeting = meetings[0];
  if (!meeting) throw new Error(`Meeting ${meetingId} not found while joining segments`);

  const ext = extensionFromMime(meeting.audio_mime ?? "audio/aac");
  const joinedKey = buildAudioKey(userId, meetingId, ext);

  /**
   * Already joined — do not do it again.
   *
   * A retry after a failure in analyze or embed re-enters here, and re-running
   * the join would re-download and re-upload the entire recording for nothing.
   * Both halves of the check matter: audio_key alone can be set while the
   * object is gone (the retention sweep clears it, but a crash between the PUT
   * and the UPDATE leaves the opposite), so the bucket is the authority.
   */
  if (meeting.audio_key && (await audioObjectExists(meeting.audio_key))) {
    return meeting.audio_key;
  }

  /**
   * Gap check, repeated from the finalize endpoint on purpose.
   *
   * Finalize validated contiguity at the moment it was called, but nothing
   * stops a straggling register from inserting a far-off index afterwards, and
   * a meeting can also be re-queued by hand. This is the last point before the
   * audio becomes a transcript, so it is the one that must not be skipped. A
   * hole here has to fail the job loudly: a transcript missing a minute in the
   * middle reads as complete and nobody would ever know to look.
   */
  const expectedTotal = segments[segments.length - 1].index + 1;
  const present = new Set(segments.map((s) => s.index));
  const missing: number[] = [];
  for (let i = 0; i < expectedTotal; i++) {
    if (!present.has(i)) missing.push(i);
  }
  if (missing.length > 0) throw new SegmentGapError(missing, expectedTotal);

  const totalBytes = segments.reduce((sum, s) => sum + Number(s.bytes), 0);
  if (totalBytes > MAX_JOINED_BYTES) {
    throw new Error(
      `Segmented recording is ${totalBytes} bytes, over the ${MAX_JOINED_BYTES} byte limit`,
    );
  }

  await concatenateAudioObjects(
    segments.map((s) => s.audio_key),
    joinedKey,
    meeting.audio_mime ?? "audio/aac",
    totalBytes,
  );

  // Written only after the object exists. From here the meeting is
  // indistinguishable from a single-file upload: playback, the retention
  // sweep, delete and retry all read audio_key and none of them need to know
  // this recording arrived in pieces.
  await sql`
    UPDATE meetings
    SET audio_key = ${joinedKey}, audio_size = ${totalBytes}
    WHERE id = ${meetingId} AND user_id = ${userId} AND workspace_id = ${workspaceId}
  `;

  /**
   * Drop the pieces, keep the rows.
   *
   * The joined object is now the durable copy, so keeping the segments doubles
   * the storage bill for every recording. The rows stay because they are the
   * only place the segment keys are written down: if one of these deletes
   * fails, the retention sweep and DELETE /meetings/:id can still find the
   * leftovers through them. Rows pointing at already-deleted objects are
   * harmless — every consumer tolerates a missing object.
   */
  await deleteAudioObjects(segments.map((s) => s.audio_key));

  return joinedKey;
}
