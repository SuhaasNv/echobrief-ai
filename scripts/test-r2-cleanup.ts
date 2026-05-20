/**
 * Test script for R2 cleanup functionality.
 * 
 * Run with:
 *   npx tsx scripts/test-r2-cleanup.ts
 * 
 * This will show what files would be deleted without actually deleting them
 * (dry run mode).
 */

import "dotenv/config";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

const RETENTION_DAYS = 7;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

async function testCleanup() {
  const env = process.env;
  
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    console.log("❌ R2 credentials not configured");
    console.log("   Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY in .env");
    return;
  }

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });

  const bucket = env.R2_BUCKET || "echobrief-audio";
  const cutoffDate = new Date(Date.now() - RETENTION_MS);

  console.log("🔍 R2 Cleanup Test (Dry Run)");
  console.log(`   Bucket: ${bucket}`);
  console.log(`   Retention: ${RETENTION_DAYS} days`);
  console.log(`   Cutoff date: ${cutoffDate.toISOString()}`);
  console.log("");

  let totalFiles = 0;
  let oldFiles = 0;
  let totalSize = 0;
  let oldSize = 0;
  let continuationToken: string | undefined;

  try {
    do {
      const response = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          ContinuationToken: continuationToken,
          MaxKeys: 1000,
        }),
      );

      const objects = response.Contents ?? [];
      totalFiles += objects.length;

      for (const obj of objects) {
        const size = obj.Size ?? 0;
        totalSize += size;

        if (obj.LastModified && obj.LastModified < cutoffDate) {
          oldFiles++;
          oldSize += size;
          console.log(`   📁 ${obj.Key}`);
          console.log(`      Age: ${Math.round((Date.now() - obj.LastModified.getTime()) / (1000 * 60 * 60 * 24))} days`);
          console.log(`      Size: ${(size / 1024 / 1024).toFixed(2)} MB`);
        }
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    console.log("");
    console.log("📊 Summary:");
    console.log(`   Total files: ${totalFiles} (${(totalSize / 1024 / 1024).toFixed(2)} MB)`);
    console.log(`   Files older than ${RETENTION_DAYS} days: ${oldFiles} (${(oldSize / 1024 / 1024).toFixed(2)} MB)`);
    
    if (oldFiles > 0) {
      console.log("");
      console.log(`✅ Cleanup would delete ${oldFiles} files and free ${(oldSize / 1024 / 1024).toFixed(2)} MB`);
    } else {
      console.log("");
      console.log("✅ No files to clean up");
    }
  } catch (error) {
    console.error("❌ Error:", error);
  }
}

testCleanup();
