/**
 * R2 / S3-compatible object storage for audio files.
 *
 * We use Cloudflare R2 via its S3-compatible API. Works from Node (or any
 * runtime) — credentials and account ID come from env.
 *
 * Upload uses S3 presigned PUT URLs so audio goes directly from browser to
 * R2 without touching our server.
 */

import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "node:stream";
import { getEnv } from "../env";

const PRESIGN_TTL_SECONDS = 60 * 60;

let _client: S3Client | null = null;

function getClient(): S3Client {
  if (_client) return _client;
  const env = getEnv();
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    throw new Error(
      "R2 credentials not configured (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)",
    );
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

/**
 * Key for one segment of a segmented recording.
 *
 * Lives under the meeting's own prefix so it inherits the ownership boundary
 * that assertOwnedAudioKey enforces, and so deleting a meeting can find every
 * object belonging to it.
 *
 * The index is zero-padded because a bucket listing sorts lexicographically:
 * unpadded, segment 10 sorts between 1 and 2, and anyone reading the bucket to
 * diagnose a bad recording would be looking at the pieces out of order. The
 * join itself sorts numerically in SQL and does not depend on this.
 */
export function buildSegmentAudioKey(
  userId: string,
  meetingId: string,
  index: number,
  ext: string,
): string {
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  return `${userId}/${meetingId}/segments/${String(index).padStart(4, "0")}.${safeExt}`;
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
    // ADTS, not MPEG-4. The distinction is the whole basis of segmented
    // recording — see ConcatenableMime in packages/shared/src/schemas.ts.
    "audio/aac": "aac",
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
    /**
     * Sign the content type, not just the length.
     *
     * `@aws-sdk/s3-request-presigner` calls `unsignableHeaders.add("content-type")`
     * unconditionally, so passing `ContentType` to the command above changes what
     * the SDK sends but NOT what the signature covers — the emitted URL carried
     * `X-Amz-SignedHeaders=content-length;host`. `ContentLength` was genuinely
     * enforced; the type was decorative.
     *
     * The consequence was that `SupportedMime` / `ConcatenableMime` governed only
     * what we wrote into `meetings.audio_mime` and which extension the key got.
     * The holder of a presigned URL could store anything under that key — HTML,
     * a binary — and then mint a signed read URL for it on demand, turning a
     * bucket we pay for into arbitrary file hosting with a mime we then
     * misreport back as `audio/aac`.
     *
     * Naming it here puts it back in the canonical request, so a PUT whose
     * Content-Type differs from the one we signed fails at R2.
     */
    signableHeaders: new Set(["content-type"]),
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

/**
 * Size of an object, or null when it is not there.
 *
 * Separate from audioObjectExists because the segment register endpoint needs
 * the byte count, not just presence, and it must come from the bucket rather
 * than from the request body — see meeting_segments.bytes in migration 0016
 * for why a wrong value there aborts the join rather than skewing a metric.
 */
export async function headAudioObject(audioKey: string): Promise<{ bytes: number } | null> {
  const env = getEnv();
  try {
    const res = await getClient().send(
      new HeadObjectCommand({
        Bucket: env.R2_BUCKET,
        Key: audioKey,
      }),
    );
    // R2 always returns ContentLength on a successful HEAD; the SDK types it
    // optional. Treat a missing value as "cannot vouch for this object" rather
    // than defaulting to 0, which would pass the caller a length that makes the
    // join silently upload a truncated file.
    if (typeof res.ContentLength !== "number") return null;
    return { bytes: res.ContentLength };
  } catch {
    return null;
  }
}

/**
 * Read the first bytes of an object, to see what it actually is.
 *
 * The upload path validates a MIME the CLIENT declared. Nothing ever looked at
 * the bytes — a repo-wide search for `ftyp`, magic-number checks or a sniffing
 * library found nothing server-side. That is fine for most formats and
 * dangerous for this one: ADTS AAC byte-concatenates losslessly, while MPEG-4
 * concatenated the same way returns `status: completed`, `error: null`, and a
 * transcript containing ONLY THE FIRST SEGMENT. Everything after it disappears
 * with no error anywhere, which is why the container is a correctness boundary
 * rather than a preference.
 *
 * A ranged GET, not a full download: 16 bytes is enough for every signature we
 * care about, and it costs one Class B operation (~$0.36 per million).
 */
export async function readObjectPrefix(audioKey: string, bytes = 16): Promise<Buffer | null> {
  const env = getEnv();
  try {
    const response = await getClient().send(
      new GetObjectCommand({
        Bucket: env.R2_BUCKET,
        Key: audioKey,
        Range: `bytes=0-${bytes - 1}`,
      }),
    );
    const body = response.Body;
    if (!body) return null;
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  } catch {
    // Absent or unreadable is the caller's problem to report, not ours to guess
    // at — the register path has already proven the object exists with a
    // HeadObject before it gets here.
    return null;
  }
}

/**
 * Delete objects, ignoring the ones that are already gone.
 *
 * Used for segment cleanup, which is best-effort by nature: the join deletes
 * the pieces once the whole recording exists as one object, and a meeting
 * deleted mid-recording has to sweep whatever arrived. Neither caller should
 * fail because a key was removed twice.
 */
export async function deleteAudioObjects(audioKeys: string[]): Promise<void> {
  if (audioKeys.length === 0) return;
  await Promise.all(
    audioKeys.map((key) =>
      deleteAudioObject(key).catch((e) => console.warn("[r2-delete-object]", key, e)),
    ),
  );
}

/**
 * Join objects into one, in the order given, without buffering them.
 *
 * WHY THIS IS A PLAIN BYTE CONCATENATION
 *
 * Callers must only pass segments in a frame-self-describing container (ADTS
 * AAC — see ConcatenableMime). For those, appending the bytes IS the join: no
 * demux, no re-encode, no container rewrite, and therefore no ffmpeg in the
 * production image. Verified end to end against AssemblyAI, which decoded a
 * concatenated pair at the full summed duration.
 *
 * WHY NOT LET R2 DO IT SERVER-SIDE
 *
 * Multipart upload with UploadPartCopy would keep the bytes out of this
 * process entirely, and was the first choice. R2 requires every part except
 * the last to be at least 5 MiB AND all of them to be the same size. A
 * 60-second speech segment is under 1 MB, so segments cannot be parts; hitting
 * 5 MiB per part would mean ~5-minute segments, which is the crash window this
 * whole feature exists to shrink. UploadPartCopy also copies from one source
 * object per part, so several segments cannot be grouped into a part without
 * downloading them anyway.
 *
 * WHY THIS DOES NOT STALL THE WORKER
 *
 * Everything here is socket I/O — one chunk is in flight at a time, the
 * process never holds the recording in memory, and nothing runs synchronously
 * long enough to keep BullMQ from renewing its lock at concurrency 10.
 *
 * `totalBytes` must be the exact sum of the source object sizes. S3 and R2
 * demand a Content-Length up front for a streamed PutObject, and a wrong value
 * aborts the request rather than storing something short.
 */
export async function concatenateAudioObjects(
  sourceKeys: string[],
  destinationKey: string,
  contentType: string,
  totalBytes: number,
): Promise<void> {
  if (sourceKeys.length === 0) {
    throw new Error("concatenateAudioObjects called with no source keys");
  }
  const env = getEnv();
  const client = getClient();

  async function* streamAll(): AsyncGenerator<Uint8Array> {
    for (const key of sourceKeys) {
      const res = await client.send(new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
      const body = res.Body;
      // Narrowed rather than cast: on Node the SDK hands back a Readable, but
      // the union also covers the web and blob shapes, and iterating one of
      // those would yield something that is not bytes. Failing here is a loud
      // bug report; a cast would have produced a corrupt object in the bucket.
      if (!(body instanceof Readable)) {
        throw new Error(`R2 returned a non-streaming body for segment ${key}`);
      }
      for await (const chunk of body) {
        yield chunk as Uint8Array;
      }
    }
  }

  await client.send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: destinationKey,
      Body: Readable.from(streamAll()),
      ContentType: contentType,
      ContentLength: totalBytes,
    }),
  );
}
