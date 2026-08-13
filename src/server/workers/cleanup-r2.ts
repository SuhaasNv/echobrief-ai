/**
 * R2 Cleanup Worker - Deletes audio past each owner's retention window.
 *
 * Driven by the database, NOT by sweeping the bucket. Audio keys are
 * `${userId}/${meetingId}/original.${ext}` (see buildAudioKey) — there is no
 * shared prefix to filter a ListObjectsV2 on, so the previous prefix-less scan
 * matched EVERY object in the bucket, including the account-export ZIPs under
 * `exports/${user_id}/` that the GDPR flow writes. It also never cleared
 * `meetings.audio_key`, leaving rows claiming audio that no longer existed:
 * `has_audio` stayed true, /audio-url happily signed URLs for deleted objects,
 * and retry passed its audio_key check before failing in the worker.
 *
 * Selecting the exact keys from Postgres fixes all of that: only audio is
 * eligible, and the row is updated in the same pass.
 *
 * RETENTION IS PER OWNER, NOT A CONSTANT. It used to be 7 days flat for
 * everyone while the settings screen offered windows up to 90 days and reported
 * the choice as saved. Someone who picked 90 lost their audio on day 7 and was
 * never told. The window now comes from user_preferences, joined on the
 * meeting's own (user_id, workspace_id) — a workspace that agreed on 30 days
 * does not impose that on the same person's other workspaces.
 *
 * This runs as a scheduled job in the worker process.
 */

import { S3Client, DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getSql } from "../db";
import { getEnv } from "../env";
import { DEFAULT_AUDIO_RETENTION_DAYS } from "../../lib/schemas";

let _client: S3Client | null = null;

function getClient(): S3Client {
  if (_client) return _client;
  const env = getEnv();
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    throw new Error("R2 credentials not configured");
  }
  _client = new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });
  return _client;
}

/** DeleteObjects accepts at most 1000 keys per request. */
const DELETE_BATCH_SIZE = 1000;

/**
 * Clean up expired R2 audio files and clear the corresponding audio_key.
 * Returns the count of objects deleted.
 */
export async function cleanupOldAudioFiles(): Promise<number> {
  const env = getEnv();
  const bucket = env.R2_BUCKET;

  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    console.warn("[r2-cleanup] R2 not configured, skipping cleanup");
    return 0;
  }

  console.log(
    `[r2-cleanup] starting cleanup (default retention: ${DEFAULT_AUDIO_RETENTION_DAYS} days, per-user overrides apply)`,
  );

  const client = getClient();
  const sql = getSql();
  let deletedCount = 0;

  try {
    for (;;) {
      // Only meetings still holding an audio key past THEIR OWNER's retention
      // window. The '' sentinel marks transcript-only meetings that never had
      // audio.
      //
      // LEFT JOIN, not JOIN: most users have never opened settings and have no
      // preferences row at all. An inner join would quietly stop deleting
      // anything for exactly those users, and the bucket would grow without a
      // single error to notice.
      //
      // The join is on both columns because that pair is the primary key of
      // user_preferences and because there is no RLS here — user_id alone would
      // apply one workspace's retention policy to another's recordings.
      //
      // `retention = 0` means "keep until I delete it" and is filtered out
      // rather than turned into a zero-day interval, which would delete the
      // audio the instant it finished uploading.
      const rows = await sql<Array<{ id: string; audio_key: string }>>`
        SELECT m.id, m.audio_key
        FROM meetings m
        LEFT JOIN user_preferences p
          ON p.user_id = m.user_id AND p.workspace_id = m.workspace_id
        WHERE m.audio_key IS NOT NULL
          AND m.audio_key <> ''
          AND COALESCE(p.audio_retention_days, ${DEFAULT_AUDIO_RETENTION_DAYS}) > 0
          AND m.created_at
              < now() - make_interval(
                  days => COALESCE(p.audio_retention_days, ${DEFAULT_AUDIO_RETENTION_DAYS})
                )
        ORDER BY m.created_at ASC
        LIMIT ${DELETE_BATCH_SIZE}
      `;

      if (rows.length === 0) break;

      // Belt and braces: never let a malformed key reach into the export
      // namespace, whatever ends up in the column.
      const eligible = rows.filter((r) => !r.audio_key.startsWith("exports/"));
      if (eligible.length !== rows.length) {
        console.error(
          `[r2-cleanup] skipped ${rows.length - eligible.length} row(s) whose audio_key pointed at exports/`,
        );
      }

      const deleteResponse = await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: eligible.map((r) => ({ Key: r.audio_key })),
            Quiet: true, // successes are omitted; Errors still returned
          },
        }),
      );

      const failedKeys = new Set((deleteResponse.Errors ?? []).map((e) => e.Key));
      if (failedKeys.size > 0) {
        console.error(
          `[r2-cleanup] ${failedKeys.size} deletion errors:`,
          (deleteResponse.Errors ?? []).slice(0, 5),
        );
      }

      // Clear audio_key ONLY for objects that actually went away, so a failed
      // delete is retried on the next run instead of being orphaned.
      const clearedIds = eligible.filter((r) => !failedKeys.has(r.audio_key)).map((r) => r.id);

      if (clearedIds.length > 0) {
        await sql`
          UPDATE meetings SET audio_key = NULL WHERE id = ANY(${clearedIds}::uuid[])
        `;
        deletedCount += clearedIds.length;
      }

      console.log(
        `[r2-cleanup] batch: deleted ${clearedIds.length} files (${eligible.length} eligible, ${failedKeys.size} errors)`,
      );

      // Everything failed or was skipped — another pass would loop forever on
      // the same rows, since nothing was cleared.
      if (clearedIds.length === 0) break;
    }

    deletedCount += await cleanupAbandonedSegments(client, bucket);

    /**
     * Last, and last on purpose.
     *
     * The two sweeps above delete objects AND their rows. Running the
     * reconciler after them means anything they just unlinked is already gone
     * from the bucket, so it is not rediscovered here as an orphan and counted
     * twice — and, more importantly, a row deleted above whose object delete
     * FAILED is left for the reconciler to finish rather than stranded.
     */
    deletedCount += await reconcileOrphanedObjects(client, bucket);

    console.log(`[r2-cleanup] completed: ${deletedCount} files deleted`);
    return deletedCount;
  } catch (error) {
    console.error("[r2-cleanup] error:", error);
    throw error;
  }
}

/**
 * Delete the segments of recordings that were never assembled.
 *
 * The sweep above cannot see these. It selects on `audio_key IS NOT NULL`, and
 * a segmented recording only gets an audio_key once the worker joins it — so a
 * recording abandoned mid-capture (the app was killed and the user never came
 * back to finish it, which is precisely the scenario segmentation exists to
 * survive) holds all of its audio in segment objects that no other code path
 * would ever revisit. Without this they outlive the owner's retention window
 * forever: not just a storage bill, but audio kept past the point the user was
 * told it would be deleted.
 *
 * Segments of recordings that WERE joined are already deleted by the worker
 * and their meetings have an audio_key, so `m.audio_key IS NULL` excludes them
 * and this only ever looks at genuinely abandoned pieces.
 *
 * The rows go with the objects. Unlike the meetings sweep — which clears
 * audio_key but keeps the row, because the meeting still has a transcript
 * worth reading — a segment row whose object is gone has no residual value,
 * and leaving it would make DELETE /meetings/:id try to re-delete it forever.
 */
async function cleanupAbandonedSegments(client: S3Client, bucket: string): Promise<number> {
  const sql = getSql();
  let deletedCount = 0;

  for (;;) {
    // Retention is the OWNER's window, joined on both columns for the same
    // reason the meetings sweep does it: user_id alone would apply one
    // workspace's policy to another's recordings. Aged on the segment's own
    // created_at, not the meeting's — a recording open for hours should not
    // have its first minute judged by when the meeting row was created.
    const rows = await sql<Array<{ audio_key: string }>>`
      SELECT s.audio_key
      FROM meeting_segments s
      JOIN meetings m ON m.id = s.meeting_id
      LEFT JOIN user_preferences p
        ON p.user_id = s.user_id AND p.workspace_id = s.workspace_id
      WHERE m.audio_key IS NULL
        AND COALESCE(p.audio_retention_days, ${DEFAULT_AUDIO_RETENTION_DAYS}) > 0
        AND s.created_at
            < now() - make_interval(
                days => COALESCE(p.audio_retention_days, ${DEFAULT_AUDIO_RETENTION_DAYS})
              )
      ORDER BY s.created_at ASC
      LIMIT ${DELETE_BATCH_SIZE}
    `;

    if (rows.length === 0) break;

    const deleteResponse = await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: rows.map((r) => ({ Key: r.audio_key })), Quiet: true },
      }),
    );

    const failedKeys = new Set((deleteResponse.Errors ?? []).map((e) => e.Key));
    if (failedKeys.size > 0) {
      console.error(
        `[r2-cleanup] ${failedKeys.size} segment deletion errors:`,
        (deleteResponse.Errors ?? []).slice(0, 5),
      );
    }

    // Same rule as the meetings sweep: only forget the ones that actually went
    // away, so a failed delete is retried next run instead of being orphaned.
    const cleared = rows.filter((r) => !failedKeys.has(r.audio_key));
    if (cleared.length > 0) {
      // Keyed on audio_key rather than the (meeting_id, index) primary key:
      // the key is minted from exactly those two columns plus the owner, so it
      // identifies the row just as precisely, and `= ANY(array)` is the same
      // form the meetings sweep above uses.
      /**
       * A plain array, NOT sql.array().
       *
       * postgres.js fails to infer the element type on the FIRST execution of a
       * statement carrying `sql.array(...)` over a fresh connection: it
       * serialises the array as a comma-joined string and Postgres answers
       * `22P02 malformed array literal: "a/b/x.aac,a/b/y.aac"`. Every later call
       * succeeds, because the statement is cached with a resolved type — which
       * is exactly what made it invisible. This sweep runs on a timer in a
       * long-lived worker, so the failing call was the first one after each
       * restart, and it threw out of cleanupOldAudioFiles.
       *
       * Reproduced deliberately: first call fails, second identical call
       * succeeds, and the plain-array form succeeds every time. postgres.js
       * serialises a JS array natively, so the helper buys nothing here.
       */
      const clearedKeys = cleared.map((r) => r.audio_key);
      await sql`
        DELETE FROM meeting_segments
        WHERE audio_key = ANY(${clearedKeys}::text[])
      `;
      deletedCount += cleared.length;
    }

    console.log(`[r2-cleanup] segment batch: deleted ${cleared.length} of ${rows.length}`);

    if (cleared.length === 0) break;
  }

  if (deletedCount > 0) {
    console.log(`[r2-cleanup] ${deletedCount} abandoned segment(s) deleted`);
  }
  return deletedCount;
}

/**
 * How long an object must be untracked before the reconciler will delete it.
 *
 * The presigned PUT lives one hour (PRESIGN_TTL_SECONDS), and a segmented
 * recording can legitimately stay open — uploading pieces against a meeting
 * whose join has not run — for as long as the 4-hour duration cap allows. 24h
 * clears both with a wide margin, so an in-flight upload is never a candidate.
 *
 * The cost of being wrong here is destroying a user's recording, so the margin
 * is deliberately far larger than the arithmetic requires.
 */
const ORPHAN_GRACE_HOURS = 24;

/** Keys examined per DB round trip. `= ANY(array)` handles this comfortably. */
const RECONCILE_BATCH = 500;

/**
 * Delete bucket objects that no database row refers to.
 *
 * THIS IS THE ONLY SWEEP THAT DOES NOT START FROM A ROW, and that is the whole
 * point of it. The other two enumerate `meetings` and `meeting_segments` and
 * delete the objects those rows name. An object that never got a row is
 * therefore invisible to both — and one is trivial to create, because
 * `POST /meetings/:id/segments/upload-url` mints a key and hands out a
 * presigned PUT WITHOUT writing anything. Upload to it, never call register,
 * and the bytes are permanent: no sweep can see them, and DELETE /meetings/:id
 * cannot either, because it also enumerates `meeting_segments`.
 *
 * At 32 MiB a segment and 1024 segments a meeting that is 32 GiB per meeting,
 * bounded only by a rate limiter that is also the one fail-open bucket in the
 * system. It is recurring storage spend that never stops growing.
 *
 * Writing a row at presign time would close the future case more cheaply, but
 * it would not touch objects already orphaned, and it would put a row in
 * `meeting_segments` that no HeadObject has confirmed — which migration 0016
 * argues against at length and correctly: a row there means "durably stored",
 * and a status column could only ever disagree with the bucket.
 *
 * So this reconciles in the other direction. It is authoritative rather than
 * clever: list what is really there, ask the database what it knows about, and
 * delete the difference once it is old enough that it cannot be in flight.
 */
async function reconcileOrphanedObjects(client: S3Client, bucket: string): Promise<number> {
  const sql = getSql();
  const cutoff = Date.now() - ORPHAN_GRACE_HOURS * 60 * 60 * 1000;

  let deletedCount = 0;
  let continuationToken: string | undefined;
  let scanned = 0;
  let batch: string[] = [];

  /** Resolve one batch against both tables and delete whatever is unreferenced. */
  const flush = async (): Promise<void> => {
    if (batch.length === 0) return;
    const keys = batch;
    batch = [];

    // Both tables, one round trip. A key can be referenced as a meeting's
    // joined audio OR as an individual segment, and deleting an object that
    // either one names would destroy a live recording.
    // `${keys}`, not `sql.array(keys)`. See the note on the segment sweep below:
    // the helper's first call on a fresh connection fails to infer its element
    // type and serialises the array as a comma-joined string.
    const known = await sql<Array<{ audio_key: string }>>`
      SELECT audio_key FROM meetings
        WHERE audio_key = ANY(${keys}::text[])
      UNION
      SELECT audio_key FROM meeting_segments
        WHERE audio_key = ANY(${keys}::text[])
    `;

    const referenced = new Set(known.map((r) => r.audio_key));
    const orphans = keys.filter((k) => !referenced.has(k));
    if (orphans.length === 0) return;

    const response = await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: orphans.map((Key) => ({ Key })), Quiet: true },
      }),
    );
    const failed = new Set((response.Errors ?? []).map((e) => e.Key));
    if (failed.size > 0) {
      console.error(
        `[r2-cleanup] ${failed.size} orphan deletion errors:`,
        (response.Errors ?? []).slice(0, 5),
      );
    }
    deletedCount += orphans.length - failed.size;
  };

  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuationToken }),
    );

    for (const object of page.Contents ?? []) {
      scanned += 1;
      if (!object.Key) continue;
      // Age is the safety rail. An object still inside the grace window may be
      // mid-upload against a live presigned URL, and its row may be seconds
      // from existing.
      if (!object.LastModified || object.LastModified.getTime() >= cutoff) continue;
      batch.push(object.Key);
      if (batch.length >= RECONCILE_BATCH) await flush();
    }

    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  await flush();

  if (deletedCount > 0) {
    console.log(`[r2-cleanup] ${deletedCount} orphaned object(s) deleted of ${scanned} scanned`);
  }
  return deletedCount;
}
