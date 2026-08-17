import { File, UploadType } from "expo-file-system";

import { api } from "@/lib/api/client";
import { beginUpload, finishUpload, reportUpload } from "@/lib/api/upload-progress";
import type { SupportedContentType } from "@/lib/audio/file-import";
import { addPendingMeeting, forgetMeeting } from "@/lib/notifications/store";
import { syncBackgroundTaskRegistration } from "@/lib/notifications/task";

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
 *
 * This is also the path a file IMPORTED from the Files app takes. It is the same
 * three hops with a different container and a different name, and the whole
 * point of the import feature is that what lands is an ordinary meeting — so it
 * gets an ordinary upload rather than a second uploader that would have to be
 * kept in step with this one.
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
const CONTENT_TYPE: SupportedContentType = "audio/mp4";

/** UploadUrlRequest caps duration_sec at four hours. */
const MAX_DURATION_SEC = 4 * 60 * 60;

/**
 * The duration we are willing to declare, or nothing.
 *
 * UploadUrlRequest takes `duration_sec` as an OPTIONAL positive integer under
 * four hours, so anything outside that is dropped rather than clamped: an
 * invented length on the row is worse than no length, and it would 400 the
 * presign — the request that creates the meeting — rather than degrading.
 *
 * Absent is the normal case for an imported file. The picker exposes no
 * duration, and the worker writes the real one back off the transcription
 * result (src/server/workers/processing.ts), so the row is only briefly blank.
 */
function declarableDuration(seconds: number | null): number | undefined {
  if (seconds === null || !Number.isFinite(seconds)) return undefined;

  const rounded = Math.round(seconds);
  return rounded > 0 && rounded <= MAX_DURATION_SEC ? rounded : undefined;
}

export async function uploadRecording(
  fileUri: string,
  opts: {
    title: string;
    /** Null when nothing on this device knows the length. See above. */
    durationSec: number | null;
    /** Null when the source carries no believable recording date. */
    recordedAt: Date | null;
    /**
     * Container the bytes are in. Defaults to the recorder's own, and is passed
     * explicitly only by the import path — it decides both the signature on the
     * PUT and the extension the server gives the R2 key, so it must be the same
     * value the client validated against SupportedMime.
     */
    contentType?: SupportedContentType;
    /**
     * Name to store alongside the meeting. Defaults to a timestamp, which is
     * all a recording has. Untrusted when it comes from a file provider — see
     * sanitizeFilename in lib/audio/file-import.ts.
     */
    filename?: string;
  },
  callbacks: UploadCallbacks = {},
): Promise<UploadResult> {
  const contentType = opts.contentType ?? CONTENT_TYPE;
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
      filename: opts.filename ?? `${Date.now()}.m4a`,
      content_type: contentType,
      size,
      // JSON.stringify drops undefined keys, so an unknown duration or date is
      // genuinely absent from the body rather than sent as null — which is what
      // the optional fields on UploadUrlRequest expect.
      duration_sec: declarableDuration(opts.durationSec),
      title: opts.title,
      recorded_at: opts.recordedAt?.toISOString(),
    },
  });

  // The row exists from here on, which is what makes the meeting reachable
  // while its bytes are still going up — so this is where the meeting screen's
  // ring starts. `onProgress` is kept alongside it rather than replaced: it is
  // this function's own contract and the import screen still passes one.
  beginUpload(presigned.meeting_id);

  try {
    const task = file.createUploadTask(presigned.upload_url, {
      httpMethod: "PUT",
      // Binary, never multipart: multipart rewrites the body and breaks the
      // signed content-length.
      uploadType: UploadType.BINARY_CONTENT,
      mimeType: contentType,
      headers: { "content-type": contentType },
      // FOREGROUND, deliberately, and this line has crashed the app before.
      //
      // The background NSURLSession in expo-file-system is one process-lifetime
      // singleton; once iOS invalidates it, every later task created on it
      // raises an ObjC NSException that neither the library's Swift catch nor
      // any JS try/catch can see — a straight SIGABRT, on the hot path of every
      // upload, presenting as "the app randomly crashes". And because the
      // recovery sweep re-drives stranded uploads on every launch, one crash
      // strands a recording that then crashes every subsequent launch.
      //
      // What the background session was buying is already provided elsewhere:
      // segments are crash-durable on disk and the recovery sweep resumes them.
      // A foreground upload suspends while backgrounded and resumes on return;
      // a real network failure arrives as a REJECTED PROMISE, which every call
      // site here already handles.
      sessionType: "foreground",
      onProgress: ({ bytesSent, totalBytes }) => {
        if (totalBytes <= 0) return;
        const ratio = bytesSent / totalBytes;
        callbacks.onProgress?.(ratio);
        reportUpload(presigned.meeting_id, ratio);
      },
    });

    const result = await task.uploadAsync();

    // uploadAsync resolves for any completed response, including 4xx — a
    // non-2xx here is a failure, not a success with a sad status.
    if (result.status < 200 || result.status >= 300) {
      throw new Error(`Storage rejected the upload (${result.status}).`);
    }
  } catch (error) {
    // The row is about to be deleted, so stop reporting against it — a progress
    // entry for a meeting that no longer exists would outlive its subject.
    finishUpload(presigned.meeting_id);

    // The meeting row already exists. Leaving it behind puts a permanent 5%
    // ghost in the library, so remove it before surfacing the failure.
    await api
      .apiRequest(`/meetings/${presigned.meeting_id}`, { method: "DELETE" })
      .catch(() => undefined);
    // The row is gone, so nothing should ever notify about it. Cheap insurance
    // against a retry that reuses the id.
    await forgetMeeting(presigned.meeting_id).catch(() => undefined);
    throw error;
  }

  // Only this call actually enqueues processing.
  await api.apiRequest("/meetings", {
    method: "POST",
    body: { meeting_id: presigned.meeting_id },
  });

  // On the confirm, not the last byte: between the final PUT and this returning,
  // the server does not yet consider the recording uploaded.
  finishUpload(presigned.meeting_id);

  // Processing has started, so this meeting is now something the user is
  // waiting on. Recorded BEFORE returning, because the whole point is that they
  // can leave the app at this instant — the pending list is what the background
  // task reads once no React state exists any more.
  //
  // Neither call may break a successful upload: the recording is safely on the
  // server by here, and failing now would tell the user otherwise.
  await addPendingMeeting({
    id: presigned.meeting_id,
    title: opts.title,
  }).catch(() => undefined);

  await syncBackgroundTaskRegistration();

  return { meetingId: presigned.meeting_id };
}
