import { File, UploadType } from "expo-file-system";

import { api } from "@/lib/api/client";

/**
 * Recording upload — three hops, and the middle one does not touch our API.
 *
 *   1. POST /meetings/upload-url  → creates the meeting row, returns a presigned URL
 *   2. PUT straight to Cloudflare R2 (binary body, not multipart)
 *   3. POST /meetings             → enqueues the processing job
 *
 * Two constraints that are easy to get wrong and fail opaquely:
 *
 * `content-length` is SIGNED into the presigned URL, so the bytes we send must
 * match the `size` we declared in step 1 exactly. Multipart or chunked encoding
 * changes the body length and yields SignatureDoesNotMatch, which reads as a
 * permissions error rather than a size mismatch. Hence UploadType.BINARY_CONTENT.
 *
 * Step 1 inserts the meeting row immediately. If the PUT then fails, that row is
 * stranded at 5% forever, so every failure path after step 1 deletes it.
 */

interface UploadUrlResponse {
  meeting_id: string;
  upload_url: string;
  audio_key: string;
  expires_at: string;
}

export interface UploadResult {
  meetingId: string;
}

export interface UploadCallbacks {
  onProgress?: (fraction: number) => void;
}

/** iOS records AAC in an MP4 container; audio/mp4 is already in SupportedMime. */
const CONTENT_TYPE = "audio/mp4";

export async function uploadRecording(
  fileUri: string,
  opts: {
    title: string;
    durationSec: number;
    recordedAt: Date;
  },
  callbacks: UploadCallbacks = {},
): Promise<UploadResult> {
  const file = new File(fileUri);

  if (!file.exists) {
    throw new Error("The recording file is missing.");
  }

  // Measured exactly once and reused for both the presign and the PUT. Reading
  // it twice invites a mismatch if anything touches the file in between.
  const size = file.size ?? 0;
  if (size <= 0) {
    throw new Error("That recording is empty.");
  }

  const presigned = await api.apiRequest<UploadUrlResponse>("/meetings/upload-url", {
    method: "POST",
    body: {
      filename: `${Date.now()}.m4a`,
      content_type: CONTENT_TYPE,
      size,
      duration_sec: Math.round(opts.durationSec),
      title: opts.title,
      recorded_at: opts.recordedAt.toISOString(),
    },
  });

  try {
    const task = file.createUploadTask(presigned.upload_url, {
      httpMethod: "PUT",
      // Binary, never multipart: multipart rewrites the body and breaks the
      // signed content-length.
      uploadType: UploadType.BINARY_CONTENT,
      mimeType: CONTENT_TYPE,
      headers: { "content-type": CONTENT_TYPE },
      // Background session so a large upload survives the user leaving the app,
      // which is exactly when they will leave it.
      sessionType: "background",
      onProgress: ({ bytesSent, totalBytes }) => {
        if (totalBytes > 0) callbacks.onProgress?.(bytesSent / totalBytes);
      },
    });

    const result = await task.uploadAsync();

    // uploadAsync resolves for any completed response, including 4xx — a
    // non-2xx here is a failure, not a success with a sad status.
    if (result.status < 200 || result.status >= 300) {
      throw new Error(`Storage rejected the upload (${result.status}).`);
    }
  } catch (error) {
    // The meeting row already exists. Leaving it behind puts a permanent 5%
    // ghost in the library, so remove it before surfacing the failure.
    await api
      .apiRequest(`/meetings/${presigned.meeting_id}`, { method: "DELETE" })
      .catch(() => undefined);
    throw error;
  }

  // Only this call actually enqueues processing.
  await api.apiRequest("/meetings", {
    method: "POST",
    body: { meeting_id: presigned.meeting_id },
  });

  return { meetingId: presigned.meeting_id };
}
