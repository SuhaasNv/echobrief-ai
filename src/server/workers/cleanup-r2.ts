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

import { S3Client, DeleteObjectsCommand } from "@aws-sdk/client-s3";
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
