/**
 * R2 / S3-compatible object storage for audio files.
 *
 * We use Cloudflare R2 via its S3-compatible API. Works from Node (or any
 * runtime) — credentials and account ID come from env.
 *
 * Upload uses S3 presigned PUT URLs so audio goes directly from browser to
 * R2 without touching our server.
 */

import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getEnv } from "../env";

const PRESIGN_TTL_SECONDS = 60 * 60;

let _client: S3Client | null = null;

function getClient(): S3Client {
  if (_client) return _client;
  const env = getEnv();
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    throw new Error("R2 credentials not configured (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)");
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

export function buildAudioKey(userId: string, meetingId: string, ext: string): string {
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  return `${userId}/${meetingId}/original.${safeExt}`;
}

export function extensionFromMime(mime: string): string {
  const map: Record<string, string> = {
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/mp4": "m4a",
    "audio/m4a": "m4a",
    "audio/x-m4a": "m4a",
    "audio/webm": "webm",
    "video/mp4": "mp4",
    "video/webm": "webm",
  };
  return map[mime] ?? "bin";
}

export async function createPresignedUploadUrl(
  audioKey: string,
  contentType: string,
  contentLength: number,
): Promise<{ upload_url: string; expires_at: string }> {
  const env = getEnv();
  const cmd = new PutObjectCommand({
    Bucket: env.R2_BUCKET,
    Key: audioKey,
    ContentType: contentType,
    ContentLength: contentLength,
  });
  const upload_url = await getSignedUrl(getClient(), cmd, {
    expiresIn: PRESIGN_TTL_SECONDS,
  });
  const expires_at = new Date(Date.now() + PRESIGN_TTL_SECONDS * 1000).toISOString();
  return { upload_url, expires_at };
}

export async function createSignedReadUrl(audioKey: string, ttlSeconds = 600): Promise<string> {
  const env = getEnv();
  const cmd = new GetObjectCommand({
    Bucket: env.R2_BUCKET,
    Key: audioKey,
  });
  return getSignedUrl(getClient(), cmd, { expiresIn: ttlSeconds });
}

export async function deleteAudioObject(audioKey: string): Promise<void> {
  const env = getEnv();
  await getClient().send(
    new DeleteObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: audioKey,
    }),
  );
}

export async function audioObjectExists(audioKey: string): Promise<boolean> {
  const env = getEnv();
  try {
    await getClient().send(
      new HeadObjectCommand({
        Bucket: env.R2_BUCKET,
        Key: audioKey,
      }),
    );
    return true;
  } catch {
    return false;
  }
}
