/**
 * R2 Cleanup Worker - Deletes audio files older than 7 days.
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
 * This runs as a scheduled job in the worker process.
 */

import { S3Client, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { getSql } from "../db";
import { getEnv } from "../env";

const RETENTION_DAYS = 7;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

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

  console.log(`[r2-cleanup] starting cleanup (retention: ${RETENTION_DAYS} days)`);

  const cutoffDate = new Date(Date.now() - RETENTION_MS);
  const client = getClient();
  const sql = getSql();
  let deletedCount = 0;

  try {
    for (;;) {
      // Only meetings still holding an audio key past the retention window.
      // The '' sentinel marks transcript-only meetings that never had audio.
      const rows = await sql<Array<{ id: string; audio_key: string }>>`
        SELECT id, audio_key
        FROM meetings
        WHERE audio_key IS NOT NULL
          AND audio_key <> ''
          AND created_at < ${cutoffDate}
        ORDER BY created_at ASC
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
          UPDATE meetings SET audio_key = NULL WHERE id = ANY(${sql.array(clearedIds)}::uuid[])
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

    console.log(`[r2-cleanup] completed: ${deletedCount} files deleted`);
    return deletedCount;
  } catch (error) {
    console.error("[r2-cleanup] error:", error);
    throw error;
  }
}
