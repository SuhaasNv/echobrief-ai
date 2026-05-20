/**
 * R2 Cleanup Worker - Deletes audio files older than 7 days.
 *
 * Runs daily to save storage costs on R2. Files are scanned by their
 * LastModified timestamp and deleted if they're older than the retention
 * period.
 *
 * This runs as a scheduled job in the worker process.
 */

import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
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

/**
 * Clean up old R2 audio files.
 * Returns the count of files deleted.
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
  let deletedCount = 0;
  let continuationToken: string | undefined;

  try {
    do {
      // List objects in the bucket (paginated)
      const listResponse = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          ContinuationToken: continuationToken,
          MaxKeys: 1000, // Process in batches of 1000
        }),
      );

      const objects = listResponse.Contents ?? [];
      if (objects.length === 0) break;

      // Filter objects older than retention period
      const oldObjects = objects.filter((obj) => {
        if (!obj.LastModified) return false;
        return obj.LastModified < cutoffDate;
      });

      if (oldObjects.length > 0) {
        // Delete old objects in batch
        const deleteResponse = await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: {
              Objects: oldObjects.map((obj) => ({ Key: obj.Key })),
              Quiet: true, // Don't return successful deletions in response
            },
          }),
        );

        const deleted = oldObjects.length - (deleteResponse.Errors?.length ?? 0);
        deletedCount += deleted;

        if (deleteResponse.Errors && deleteResponse.Errors.length > 0) {
          console.error(
            `[r2-cleanup] ${deleteResponse.Errors.length} deletion errors:`,
            deleteResponse.Errors.slice(0, 5), // Log first 5 errors
          );
        }

        console.log(
          `[r2-cleanup] batch: deleted ${deleted} files (${oldObjects.length} eligible, ${deleteResponse.Errors?.length ?? 0} errors)`,
        );
      }

      continuationToken = listResponse.NextContinuationToken;
    } while (continuationToken);

    console.log(`[r2-cleanup] completed: ${deletedCount} files deleted`);
    return deletedCount;
  } catch (error) {
    console.error("[r2-cleanup] error:", error);
    throw error;
  }
}
