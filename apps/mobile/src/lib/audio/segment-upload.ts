import { UploadType } from "expo-file-system";

import { api } from "@/lib/api/client";
import { isPlaceholderTitle } from "@/lib/format";
import { beginUpload, failUpload, finishUpload, reportUpload } from "@/lib/api/upload-progress";
import { addPendingMeeting } from "@/lib/notifications/store";
import { syncBackgroundTaskRegistration } from "@/lib/notifications/task";

import {
  deleteRecording,
  discardSegment,
  findSegment,
  listRecordings,
  listSegments,
  readManifest,
  writeManifest,
  type RecordingManifest,
  type StoredSegment,
} from "./segment-store";

/**
 * The upload half of crash-durable recording.
 *
 * Four server calls, all under /meetings:
 *
 *   POST /segmented                  open the recording, get the meeting id
 *   POST /:id/segments/upload-url    presign one segment
 *   PUT  <presigned>                 straight to R2, never through our API
 *   POST /:id/segments               register it once it has landed
 *   POST /:id/segments/complete      close the recording and queue it
 *
 * Two things are easy to get wrong here and both fail opaquely:
 *
 * The presigned PUT is signed with BOTH the content type and the exact content
 * length declared at presign time. A body of any other size comes back as
 * `SignatureDoesNotMatch`, which reads like a credentials problem rather than
 * the size mismatch it is. So the size is read off the file immediately before
 * the presign and the same file is then sent with BINARY_CONTENT — multipart
 * would rewrite the body and change its length.
 *
 * Segment `index` is 0-based and dense. The server's finalize refuses a
 * recording with a hole in it and says exactly which indexes are missing, which
 * is the whole recovery path: re-upload those, call complete again.
 *
 * A session lives at MODULE scope, not inside a hook. The user pressing "End
 * meeting" navigates away immediately and the Record screen unmounts; the
 * upload has to outlive it. Nothing in here may assume a React tree exists.
 */

const CONTENT_TYPE = "audio/aac";

/**
 * Local copies of three server constants, NOT a second source of truth.
 *
 * The authoritative values live in ConcatenableMime / SEGMENT_TARGET_SECONDS /
 * MAX_SEGMENT_BYTES in packages/shared/src/schemas.ts, and the two that matter
 * at runtime are echoed back by POST /meetings/segmented precisely so a client
 * does not have to hardcode them — `segment_target_seconds` from that response
 * is what the recorder actually rotates on, and this is only the value used for
 * the first segment, before the response arrives.
 *
 * Copied rather than imported because `@echobrief/shared` is the Zod schema
 * barrel: importing it would pull zod into the app bundle for three integers,
 * and nothing on this platform imports it today.
 */
const DEFAULT_TARGET_SECONDS = 60;
const MAX_SEGMENT_BYTES = 32 * 1024 * 1024;
/** Mirrors the CHECK in migration 0016. ~17 hours at the 60s target. */
const MAX_SEGMENTS_PER_MEETING = 1024;

/**
 * How many segments may be in flight at once.
 *
 * Out-of-order arrival is a non-event server-side — the primary key is
 * (meeting_id, index) and the join orders by index, never by arrival — so there
 * is no reason to serialise. Two, not more: these upload while the microphone
 * is live, and the recording is the job that must not be starved.
 */
const MAX_CONCURRENT_UPLOADS = 2;

/** Attempts per segment before it is left for the finalize gap check to catch. */
const MAX_ATTEMPTS = 4;

/** Rounds of "finalize said these are missing, send them again". */
const MAX_GAP_ROUNDS = 3;

interface SegmentedOpenResponse {
  meeting_id: string;
  status: "queued";
  segment_target_seconds: number;
  max_segment_bytes: number;
}

interface SegmentUploadUrlResponse {
  index: number;
  upload_url: string;
  audio_key: string;
  expires_at: string;
}

interface SegmentRegisterResponse {
  index: number;
  bytes: number;
  registered_count: number;
}

interface SegmentCompleteResponse {
  meeting_id: string;
  status: "queued";
  segment_count: number;
  total_bytes: number;
}

interface SegmentGapError {
  error: "incomplete_segments";
  message: string;
  missing: number[];
  expected_total: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseGapError(value: unknown): SegmentGapError | null {
  if (!isRecord(value)) return null;
  if (value.error !== "incomplete_segments") return null;
  if (!Array.isArray(value.missing)) return null;
  const missing = value.missing.filter((n): n is number => typeof n === "number");
  const expected = typeof value.expected_total === "number" ? value.expected_total : missing.length;
  return {
    error: "incomplete_segments",
    message: typeof value.message === "string" ? value.message : "Some segments are missing.",
    missing,
    expected_total: expected,
  };
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : "The upload could not be completed.";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* -------------------------------------------------------------------------- */
/* Session                                                                     */
/* -------------------------------------------------------------------------- */

const sessions = new Map<string, UploadSession>();

class UploadSession {
  private manifest: RecordingManifest;

  /** Indexes the server has confirmed. */
  private readonly registered = new Set<number>();
  /** Indexes handed to this session, whether or not they have landed yet. */
  private readonly known = new Set<number>();

  /**
   * Bytes per segment, and how many are confirmed. The progress ring's numerator
   * and denominator.
   *
   * Bytes rather than a segment count because segments are not the same size —
   * the last one is a fraction of a rotation — and a count would make the ring
   * stall on the largest and then jump.
   */
  private readonly bytesByIndex = new Map<number, number>();
  private confirmedBytes = 0;

  /**
   * Whether this session is reporting to the progress store yet.
   *
   * Nothing is reported WHILE recording. The ratio is monotonic by contract, so
   * a running total over a denominator that is still growing would climb to 1
   * after the first segment and be stuck there for the rest of the meeting.
   * Reporting starts at finish(), when the denominator is finally known — which
   * is also the first moment the user can see a ring, because it is the moment
   * they land on the meeting.
   */
  private reporting = false;

  /** Indexes waiting for a worker. */
  private readonly queue: number[] = [];
  private workers = 0;
  /** Resolves when the queue is empty and no worker is running. */
  private drained: Promise<void> = Promise.resolve();
  private resolveDrained: (() => void) | null = null;

  /**
   * The open call, kept as a promise rather than awaited at the call site.
   *
   * Capture must not wait on the network: the user pressed record and the
   * microphone has to be live now, not after a round-trip, and a recording
   * started with no signal must still be captured. Every upload awaits this
   * before it can presign, so the segments simply queue up until the meeting
   * exists.
   */
  private opening: Promise<string> | null = null;

  constructor(manifest: RecordingManifest) {
    this.manifest = manifest;
  }

  get meetingId(): string | null {
    return this.manifest.meetingId;
  }

  get localId(): string {
    return this.manifest.localId;
  }

  /**
   * Push the current ratio to the progress store.
   *
   * Confirmed bytes over total bytes, which is monotonic by construction: the
   * numerator only grows, and the denominator is frozen once finish() has been
   * called. That matters because reportUpload discards any value that is not an
   * increase, so a ratio that could dip would simply stop updating.
   */
  private report(): void {
    const meetingId = this.manifest.meetingId;
    if (!this.reporting || !meetingId) return;

    let total = 0;
    for (const bytes of this.bytesByIndex.values()) total += bytes;
    if (total <= 0) return;

    reportUpload(meetingId, this.confirmedBytes / total);
  }

  /**
   * Open the meeting row, once.
   *
   * Idempotent by memoising the promise: several segments can finish before the
   * first round-trip returns, and each of them calls this.
   */
  open(): Promise<string> {
    if (this.manifest.meetingId) return Promise.resolve(this.manifest.meetingId);
    if (this.opening) return this.opening;

    this.opening = (async () => {
      const response = await api.apiRequest<SegmentedOpenResponse>("/meetings/segmented", {
        method: "POST",
        body: {
          /**
           * Empty when the recorder's placeholder was never replaced.
           *
           * The manifest keeps the readable timestamp because the recovery
           * dialog quotes it back ("'Thu, Aug 13 at 3:15 PM' was interrupted"),
           * but the SERVER must not receive it. That placeholder is built with
           * toLocaleString, so it is locale-shaped — "jeu. 13 août à 15:15" in
           * French — and the worker's "did the user choose this?" guard is a
           * regex written for the English form. A non-English user's untouched
           * title read as one they had picked, so the generated title never
           * replaced it and every meeting kept its timestamp forever.
           *
           * Sending "" states the fact rather than encoding it in a string
           * somebody later has to pattern-match. displayTitle renders the
           * recording's own date, in the user's locale, until the model names it.
           */
          // undefined, not "": an absent field is unambiguously "no title" and
          // survives any server-side min-length check; the server defaults it to
          // "Untitled recording". (Sending "" tripped a schema min(1) and 400'd.)
          title: isPlaceholderTitle(this.manifest.title) ? undefined : this.manifest.title.trim(),
          content_type: CONTENT_TYPE,
          recorded_at: this.manifest.recordedAt,
        },
      });

      this.manifest = {
        ...this.manifest,
        meetingId: response.meeting_id,
        targetSeconds: response.segment_target_seconds,
      };
      // Durable before anything is uploaded against it. A meeting id that only
      // ever existed in memory would strand every segment already in R2.
      await writeManifest(this.manifest);
      return response.meeting_id;
    })();

    // A failed open must not poison the memo — the next segment should be able
    // to try again rather than inheriting a rejected promise forever.
    this.opening.catch(() => {
      this.opening = null;
    });

    return this.opening;
  }

  /** The rotation cadence the server asked for, once it has told us. */
  get targetSeconds(): number {
    return this.manifest.targetSeconds;
  }

  /** A segment has closed and been filed under its index. Send it. */
  enqueue(index: number): void {
    if (this.known.has(index)) return;
    this.known.add(index);

    // Measured now, while the file is certainly still there. After a successful
    // register the local copy is deleted, so this is the only chance to record
    // what it weighed — and the progress denominator has to survive that.
    const segment = findSegment(this.manifest.localId, index);
    if (segment) this.bytesByIndex.set(index, segment.bytes);

    this.queue.push(index);
    this.pump();
  }

  private pump(): void {
    while (this.workers < MAX_CONCURRENT_UPLOADS && this.queue.length > 0) {
      const index = this.queue.shift();
      if (index === undefined) return;

      if (this.workers === 0 && !this.resolveDrained) {
        this.drained = new Promise((resolve) => {
          this.resolveDrained = resolve;
        });
      }
      this.workers += 1;

      void this.sendWithRetry(index).finally(() => {
        this.workers -= 1;
        if (this.workers === 0 && this.queue.length === 0) {
          this.resolveDrained?.();
          this.resolveDrained = null;
        } else {
          this.pump();
        }
      });
    }
  }

  /**
   * One segment, with backoff.
   *
   * A segment that exhausts its attempts is NOT an error yet. It is left
   * un-registered on purpose, because finalize is about to ask the server which
   * indexes are missing and that answer is authoritative in a way a local retry
   * counter is not — the register may well have succeeded and only its response
   * been lost.
   */
  private async sendWithRetry(index: number): Promise<void> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        await this.send(index);
        return;
      } catch (error) {
        if (attempt === MAX_ATTEMPTS) {
          // Swallowed deliberately, and only here: the gap check is the
          // backstop, and throwing out of a background worker nobody is
          // awaiting would be an unhandled rejection.
          void error;
          return;
        }
        await delay(1000 * 2 ** (attempt - 1));
      }
    }
  }

  private async send(index: number): Promise<void> {
    if (this.registered.has(index)) return;

    const meetingId = await this.open();
    const segment = findSegment(this.manifest.localId, index);
    if (!segment) return;

    this.bytesByIndex.set(index, segment.bytes);
    await putAndRegister(meetingId, segment);

    this.registered.add(index);
    this.confirmedBytes += segment.bytes;
    // The bytes are in R2 and the server has confirmed them with a HeadObject,
    // so the local copy is now redundant. See discardSegment.
    discardSegment(this.manifest.localId, index);
    this.report();
  }

  /**
   * Everything the recorder produced is in. Close the recording.
   *
   * `totalSegments` is what separates "the meeting was six segments long" from
   * "six and seven were lost", so it is sent on a clean stop and omitted only
   * when recovering a recording whose own count died with the process.
   */
  async finish(input: { totalSegments: number | null; durationSec: number | null }): Promise<void> {
    this.manifest = {
      ...this.manifest,
      totalSegments: input.totalSegments,
      durationSec: input.durationSec,
    };
    await writeManifest(this.manifest).catch(() => undefined);

    // From here the user is looking at the meeting screen, so the ring is
    // reporting. Typically it starts near full: every segment but the last was
    // uploaded while the microphone was still open.
    this.reporting = true;

    try {
      const meetingId = await this.open();
      beginUpload(meetingId);
      this.report();

      await this.drainAndFinalize(meetingId);

      // On the CONFIRM, not the last byte: complete is what actually queues the
      // recording for processing, and clearing before it returned would show the
      // pipeline as started before it was.
      finishUpload(meetingId);

      // Processing has started, so this is now something the user is waiting
      // on. Neither of these may break a successful upload — the audio is
      // safely on the server by here, and failing now would say otherwise.
      await addPendingMeeting({ id: meetingId, title: this.manifest.title }).catch(() => undefined);
      await syncBackgroundTaskRegistration().catch(() => undefined);

      // The segments are consumed and the meeting is queued; nothing on this
      // device is load-bearing any more.
      deleteRecording(this.manifest.localId);
      sessions.delete(this.manifest.localId);
    } catch (error) {
      const meetingId = this.manifest.meetingId;
      // The session and its files are deliberately KEPT. The audio is still on
      // this iPhone and the meeting screen offers a retry; throwing it away
      // here would make that button a lie.
      if (meetingId) failUpload(meetingId, messageFor(error));
    }
  }

  private async drainAndFinalize(meetingId: string): Promise<void> {
    for (let round = 0; round <= MAX_GAP_ROUNDS; round++) {
      await this.drained;

      const outcome = await finalizeOnce(meetingId, {
        totalSegments: this.manifest.totalSegments,
        durationSec: this.manifest.durationSec,
      });

      if (outcome.kind === "done") return;

      // The server named the holes. Re-upload exactly those and ask again.
      // Anything it says is missing that this device no longer has is
      // unrecoverable, and saying so is better than looping.
      const unrecoverable: number[] = [];
      let requeued = 0;
      for (const index of outcome.gap.missing) {
        if (this.registered.delete(index)) {
          // It was counted as confirmed and is not. Give the bytes back so the
          // ratio still means what it says.
          this.confirmedBytes -= this.bytesByIndex.get(index) ?? 0;
        }
        if (findSegment(this.manifest.localId, index)) {
          this.known.delete(index);
          this.enqueue(index);
          requeued += 1;
        } else {
          unrecoverable.push(index);
        }
      }

      if (requeued === 0) {
        throw new Error(
          unrecoverable.length > 0
            ? `Part of this recording (segment${unrecoverable.length > 1 ? "s" : ""} ${unrecoverable.join(", ")}) is no longer on this iPhone.`
            : outcome.gap.message,
        );
      }
    }

    throw new Error("Some parts of this recording could not be uploaded.");
  }

  /**
   * Try the whole close again after a failure.
   *
   * Everything it needs is still on disk — nothing is deleted until the server
   * has the recording — so this re-queues whatever is left and finalizes again.
   */
  async retry(): Promise<void> {
    for (const segment of listSegments(this.manifest.localId)) {
      this.known.delete(segment.index);
      this.enqueue(segment.index);
    }
    await this.finish({
      totalSegments: this.manifest.totalSegments,
      durationSec: this.manifest.durationSec,
    });
  }

  /** Throw the recording away, locally and on the server. */
  async abandon(): Promise<void> {
    const meetingId = this.manifest.meetingId;
    sessions.delete(this.manifest.localId);
    deleteRecording(this.manifest.localId);

    if (meetingId) {
      finishUpload(meetingId);
      await api.apiRequest(`/meetings/${meetingId}`, { method: "DELETE" }).catch(() => undefined);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* The three network steps for one segment                                     */
/* -------------------------------------------------------------------------- */

async function putAndRegister(meetingId: string, segment: StoredSegment): Promise<void> {
  // Read the size HERE, immediately before the presign, and send exactly this
  // file. The presigned URL is signed with the length, so a size measured at
  // some earlier point and a body of some other length is SignatureDoesNotMatch.
  const size = segment.file.size;
  if (size <= 0) throw new Error(`Segment ${segment.index} is empty.`);
  if (size > MAX_SEGMENT_BYTES) throw new Error(`Segment ${segment.index} is too large to upload.`);

  const presigned = await api.apiRequest<SegmentUploadUrlResponse>(
    `/meetings/${meetingId}/segments/upload-url`,
    { method: "POST", body: { index: segment.index, size } },
  );

  const task = segment.file.createUploadTask(presigned.upload_url, {
    httpMethod: "PUT",
    // Binary, never multipart: multipart rewrites the body and breaks the
    // signed content-length.
    uploadType: UploadType.BINARY_CONTENT,
    mimeType: CONTENT_TYPE,
    headers: { "content-type": CONTENT_TYPE },
    // FOREGROUND, deliberately — see the long note in upload.ts. The library's
    // background NSURLSession raises un-catchable ObjC exceptions once iOS has
    // invalidated it (a process-lifetime singleton), which aborted the app on
    // the segment hot path mid-recording. Durability lives in the on-disk
    // segment store + recovery sweep, not in the session type; a foreground
    // upload's failure is a rejected promise the retry logic already handles.
    sessionType: "foreground",
  });

  const result = await task.uploadAsync();
  // uploadAsync resolves for any completed response, 4xx included. A non-2xx
  // here is a failure, not a success with a sad status.
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Storage rejected segment ${segment.index} (${result.status}).`);
  }

  // Idempotent server-side: a register retried after a network timeout upserts
  // its own row rather than duplicating or conflicting.
  await api.apiRequest<SegmentRegisterResponse>(`/meetings/${meetingId}/segments`, {
    method: "POST",
    body: { index: segment.index },
  });
}

type FinalizeOutcome =
  | { kind: "done"; response: SegmentCompleteResponse }
  | { kind: "gap"; gap: SegmentGapError };

/**
 * POST complete, read as a raw response.
 *
 * `raw` because the gap error's payload is the recovery path and the shared
 * client's ApiError keeps only `error`, `message` and `details` — `missing` and
 * `expected_total` would be dropped on the floor, leaving nothing to act on but
 * a retry of the same failing request.
 */
async function finalizeOnce(
  meetingId: string,
  input: { totalSegments: number | null; durationSec: number | null },
): Promise<FinalizeOutcome> {
  const response = await api.apiRequest<Response>(`/meetings/${meetingId}/segments/complete`, {
    method: "POST",
    raw: true,
    body: {
      // JSON.stringify drops undefined keys, so an unknown total is genuinely
      // absent rather than sent as null — which is what the optional fields on
      // SegmentCompleteRequest expect. Omitted after a crash, where max(index)+1
      // is the best available answer.
      total_segments: input.totalSegments ?? undefined,
      duration_sec:
        input.durationSec !== null && input.durationSec >= 0
          ? Math.round(input.durationSec)
          : undefined,
    },
  });

  const payload: unknown = await response.json().catch(() => null);

  if (response.ok) {
    if (!isRecord(payload) || typeof payload.meeting_id !== "string") {
      throw new Error("The server gave an unreadable answer when closing this recording.");
    }
    return {
      kind: "done",
      response: {
        meeting_id: payload.meeting_id,
        status: "queued",
        segment_count: typeof payload.segment_count === "number" ? payload.segment_count : 0,
        total_bytes: typeof payload.total_bytes === "number" ? payload.total_bytes : 0,
      },
    };
  }

  const gap = parseGapError(payload);
  if (gap) return { kind: "gap", gap };

  const message =
    isRecord(payload) && typeof payload.message === "string"
      ? payload.message
      : `This recording could not be closed (${response.status}).`;
  throw new Error(message);
}

/* -------------------------------------------------------------------------- */
/* Public surface                                                              */
/* -------------------------------------------------------------------------- */

export function startSession(manifest: RecordingManifest): UploadSession {
  const existing = sessions.get(manifest.localId);
  if (existing) return existing;

  const session = new UploadSession(manifest);
  sessions.set(manifest.localId, session);
  // Opened eagerly and in parallel with capture, never awaited by it.
  session.open().catch(() => undefined);
  return session;
}

export function getSession(localId: string): UploadSession | undefined {
  return sessions.get(localId);
}

/**
 * The session behind a meeting, for the retry the meeting screen offers.
 *
 * By meeting id rather than local id because that is the only identifier the
 * meeting screen has — it was never involved in starting the recording.
 */
export function findSessionByMeeting(meetingId: string): UploadSession | null {
  for (const session of sessions.values()) {
    if (session.meetingId === meetingId) return session;
  }
  return null;
}

/**
 * Retry a failed upload, from the meeting screen.
 *
 * Resolves to false when there is nothing on this device to retry with — the
 * process was restarted, or the recording was already cleaned up — so the
 * caller can say so instead of appearing to do nothing.
 */
export async function retryUpload(meetingId: string): Promise<boolean> {
  const session = findSessionByMeeting(meetingId);
  if (session) {
    await session.retry();
    return true;
  }

  // No live session: a cold start after a failure. The manifest on disk still
  // knows which meeting it belongs to.
  for (const manifest of listRecordings()) {
    if (manifest.meetingId !== meetingId) continue;
    await resumeRecording(manifest.localId);
    return true;
  }
  return false;
}

export type { UploadSession };

/**
 * A recording found on disk that nothing is currently working on.
 *
 * Either the process died mid-meeting, or the finalize failed and the app was
 * closed before it could be retried. Both are the same job: send what is left
 * and close the recording.
 */
export interface OrphanedRecording {
  manifest: RecordingManifest;
  segmentCount: number;
  /** Highest index on disk, +1. What the server will assume if we cannot say. */
  impliedTotal: number;
}

/**
 * Every recording on disk that is not being worked on right now.
 *
 * A recording with a session is in flight and must not be swept up by the
 * recovery path — that would race two uploaders against the same indexes.
 */
export function findOrphanedRecordings(): OrphanedRecording[] {
  const orphans: OrphanedRecording[] = [];

  for (const manifest of listRecordings()) {
    if (sessions.has(manifest.localId)) continue;

    const segments = listSegments(manifest.localId);
    // Nothing left to send and nothing to close: either it never captured
    // anything, or its segments were all registered and only the cleanup was
    // lost. A recording with a meeting id still deserves a finalize.
    if (segments.length === 0 && !manifest.meetingId) {
      deleteRecording(manifest.localId);
      continue;
    }

    const last = segments[segments.length - 1];
    orphans.push({
      manifest,
      segmentCount: segments.length,
      impliedTotal: last ? last.index + 1 : 0,
    });
  }

  return orphans;
}

/**
 * Finish a recording that outlived the process that made it.
 *
 * `total_segments` is deliberately NOT sent when the manifest never recorded
 * one: max(index)+1 is then the best available answer, and it still catches
 * every hole in the middle — just not a tail that was never written. Claiming a
 * total we did not observe would be worse, because it would tell the server a
 * truncated recording was whole.
 */
export async function resumeRecording(localId: string): Promise<void> {
  const manifest = readManifest(localId);
  if (!manifest) return;

  const session = startSession(manifest);
  for (const segment of listSegments(localId)) {
    session.enqueue(segment.index);
  }
  await session.finish({
    totalSegments: manifest.totalSegments,
    durationSec: manifest.durationSec,
  });
}

export async function discardRecording(localId: string): Promise<void> {
  const session = sessions.get(localId);
  if (session) {
    await session.abandon();
    return;
  }

  const manifest = readManifest(localId);
  deleteRecording(localId);
  if (manifest?.meetingId) {
    finishUpload(manifest.meetingId);
    await api
      .apiRequest(`/meetings/${manifest.meetingId}`, { method: "DELETE" })
      .catch(() => undefined);
  }
}

export { MAX_SEGMENTS_PER_MEETING, DEFAULT_TARGET_SECONDS };
