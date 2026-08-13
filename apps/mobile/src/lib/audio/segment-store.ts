import { Directory, File, Paths } from "expo-file-system";

/**
 * The on-disk record of a segmented recording.
 *
 * This module exists because of one requirement: the ledger has to survive the
 * process dying. That is the entire point of segmented capture — a crash, a
 * force-quit or an OS memory kill must cost at most the segment still being
 * written — and an in-memory list of pending segments would be destroyed by
 * exactly the event it is supposed to protect against.
 *
 * Layout, under the DOCUMENT directory rather than the cache:
 *
 *   recordings/<localId>/manifest.json
 *   recordings/<localId>/seg-0000.aac
 *   recordings/<localId>/seg-0001.aac
 *
 * Documents, because iOS purges the cache directory under storage pressure and
 * the cache is where expo-audio writes by default. A recorder whose segments
 * can be deleted out from under it while the meeting is still in progress is
 * not crash-durable, it is a slower way to lose the same audio.
 *
 * The single most important design decision here: **the segment index lives in
 * the FILENAME, not in the manifest**. The manifest is written a handful of
 * times per recording (open, meeting id assigned, clean stop); the segment set
 * changes every 60 seconds. If the index lived only in the manifest, then every
 * rotation would need a durable manifest write, and a crash between "the audio
 * file was closed" and "the manifest recorded it" would strand a real segment
 * with no way to know where it belonged. With the index in the filename, a
 * directory listing IS the ledger, it is updated atomically by the filesystem
 * as a side effect of the rename that files the segment, and there is no window
 * in which the two disagree.
 */

/** Root for every recording this device has that is not finished with. */
const ROOT = "recordings";

/** Manifest filename, and the scratch file the atomic rewrite goes through. */
const MANIFEST = "manifest.json";
const MANIFEST_TMP = "manifest.json.tmp";

const SEGMENT_PREFIX = "seg-";
const SEGMENT_EXTENSION = ".aac";
/** Zero-padded so a directory listing sorts into recording order by name. */
const INDEX_DIGITS = 4;

/**
 * Everything about a recording that is NOT recoverable from the files.
 *
 * Deliberately small. Anything that can be derived from the directory (which
 * segments exist, how big they are) is derived, because a manifest field and a
 * filesystem fact that disagree after a crash is a bug with no good resolution.
 */
export interface RecordingManifest {
  /** Directory name. Assigned before any network call, so capture never waits. */
  localId: string;
  /**
   * Server meeting id, or null.
   *
   * Null is a real state, not a transient one: capture starts immediately and
   * POST /meetings/segmented happens in parallel, so a recording made on a
   * plane genuinely has segments on disk and no meeting to attach them to. The
   * recovery path opens one later.
   */
  meetingId: string | null;
  title: string;
  /** ISO 8601. When the user pressed record. */
  recordedAt: string;
  /** Rotation cadence this recording was captured at, from the server. */
  targetSeconds: number;
  /**
   * How many segments the recorder actually rotated through, or null.
   *
   * Set ONLY on a clean stop. Null means the process died mid-recording, and it
   * is the flag that decides whether finalize may send `total_segments` — see
   * the note on SegmentCompleteRequest. Sending a total we did not really
   * observe would tell the server a truncated recording was complete.
   */
  totalSegments: number | null;
  /** Wall-clock seconds, known only on a clean stop. */
  durationSec: number | null;
  createdAt: number;
}

export interface StoredSegment {
  index: number;
  file: File;
  bytes: number;
}

function rootDirectory(): Directory {
  return new Directory(Paths.document, ROOT);
}

function recordingDirectory(localId: string): Directory {
  return new Directory(rootDirectory(), localId);
}

export function segmentFilename(index: number): string {
  return `${SEGMENT_PREFIX}${String(index).padStart(INDEX_DIGITS, "0")}${SEGMENT_EXTENSION}`;
}

function parseSegmentIndex(name: string): number | null {
  if (!name.startsWith(SEGMENT_PREFIX) || !name.endsWith(SEGMENT_EXTENSION)) return null;
  const digits = name.slice(SEGMENT_PREFIX.length, name.length - SEGMENT_EXTENSION.length);
  if (!/^\d+$/.test(digits)) return null;
  const index = Number.parseInt(digits, 10);
  return Number.isSafeInteger(index) && index >= 0 ? index : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Parse defensively.
 *
 * This blob is written by one build of the app and read by the next, after a
 * crash, on a launch path the user cannot see. A shape change has to degrade to
 * "this recording is unrecoverable" and be skipped, never to an exception
 * thrown during startup.
 */
function parseManifest(raw: string, localId: string): RecordingManifest | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return null;
    if (typeof value.title !== "string" || typeof value.recordedAt !== "string") return null;

    return {
      localId,
      meetingId: typeof value.meetingId === "string" ? value.meetingId : null,
      title: value.title,
      recordedAt: value.recordedAt,
      targetSeconds: typeof value.targetSeconds === "number" ? value.targetSeconds : 60,
      totalSegments: typeof value.totalSegments === "number" ? value.totalSegments : null,
      durationSec: typeof value.durationSec === "number" ? value.durationSec : null,
      createdAt: typeof value.createdAt === "number" ? value.createdAt : Date.now(),
    };
  } catch {
    return null;
  }
}

/** Create the directory for a new recording. Cheap, and never touches the network. */
export function createRecording(input: {
  localId: string;
  title: string;
  recordedAt: Date;
  targetSeconds: number;
}): RecordingManifest {
  const dir = recordingDirectory(input.localId);
  dir.create({ intermediates: true, idempotent: true });

  const manifest: RecordingManifest = {
    localId: input.localId,
    meetingId: null,
    title: input.title,
    recordedAt: input.recordedAt.toISOString(),
    targetSeconds: input.targetSeconds,
    totalSegments: null,
    durationSec: null,
    createdAt: Date.now(),
  };
  writeManifestSync(manifest);
  return manifest;
}

/**
 * Rewrite the manifest atomically.
 *
 * Through a scratch file and a rename, because a torn manifest is worse than a
 * stale one: a half-written JSON blob loses the meeting id, and the meeting id
 * is the only thing tying segments already in R2 to the row they belong to.
 * The rename is what the filesystem gives us that is genuinely atomic.
 */
export async function writeManifest(manifest: RecordingManifest): Promise<void> {
  const dir = recordingDirectory(manifest.localId);
  dir.create({ intermediates: true, idempotent: true });

  const tmp = new File(dir, MANIFEST_TMP);
  if (tmp.exists) tmp.delete();
  tmp.create();
  tmp.write(JSON.stringify(manifest));
  await tmp.move(new File(dir, MANIFEST), { overwrite: true });
}

/**
 * The same write, without the rename.
 *
 * Used only to lay down the very first manifest, where there is nothing to tear
 * — the file does not exist yet, so a crash mid-write leaves an unparseable
 * manifest for a recording that has no segments either, and the whole directory
 * is discarded on the next launch.
 */
function writeManifestSync(manifest: RecordingManifest): void {
  const file = new File(recordingDirectory(manifest.localId), MANIFEST);
  if (file.exists) file.delete();
  file.create();
  file.write(JSON.stringify(manifest));
}

export function readManifest(localId: string): RecordingManifest | null {
  const file = new File(recordingDirectory(localId), MANIFEST);
  if (!file.exists) return null;
  try {
    return parseManifest(file.textSync(), localId);
  } catch {
    return null;
  }
}

/**
 * File a closed segment under its index.
 *
 * A rename within the same volume, so it is atomic and effectively free — the
 * bytes are not copied. Until this resolves the segment is a
 * `recording-<uuid>.aac` in expo-audio's own directory with nothing to say
 * where it belongs; afterwards its position in the meeting is a property of the
 * filesystem.
 */
export async function adoptSegment(
  localId: string,
  index: number,
  sourceUri: string,
): Promise<StoredSegment | null> {
  const source = new File(sourceUri);
  if (!source.exists) return null;

  const dir = recordingDirectory(localId);
  dir.create({ intermediates: true, idempotent: true });

  const destination = new File(dir, segmentFilename(index));
  await source.move(destination, { overwrite: true });

  // Re-read rather than trusting the pre-move handle: the size that goes to the
  // presign has to be the size of the object we are about to PUT, and the
  // presigned URL is signed with it.
  const moved = new File(dir, segmentFilename(index));
  return { index, file: moved, bytes: moved.size };
}

/** Every segment currently on disk for a recording, in index order. */
export function listSegments(localId: string): StoredSegment[] {
  const dir = recordingDirectory(localId);
  if (!dir.exists) return [];

  const segments: StoredSegment[] = [];
  for (const entry of dir.list()) {
    if (!(entry instanceof File)) continue;
    const index = parseSegmentIndex(entry.name);
    if (index === null) continue;
    // A zero-byte file is a segment whose write did not survive. It cannot be
    // presigned (size must be positive) and uploading it would register an
    // empty object, so it is treated as absent and left for the gap check.
    if (entry.size <= 0) continue;
    segments.push({ index, file: entry, bytes: entry.size });
  }
  segments.sort((a, b) => a.index - b.index);
  return segments;
}

export function findSegment(localId: string, index: number): StoredSegment | null {
  const file = new File(recordingDirectory(localId), segmentFilename(index));
  if (!file.exists || file.size <= 0) return null;
  return { index, file, bytes: file.size };
}

/**
 * Drop a segment's bytes once the server has confirmed them.
 *
 * Safe only after a successful register, and safe precisely because register is
 * not the client's word for it: the server does a HeadObject against R2 before
 * writing the row, so a 200 from it means the bytes are in storage. Without
 * this an hour-long meeting would leave ~60MB of already-uploaded audio sitting
 * in Documents, which is the directory that is never reclaimed.
 */
export function discardSegment(localId: string, index: number): void {
  const file = new File(recordingDirectory(localId), segmentFilename(index));
  if (file.exists) file.delete();
}

/** Everything on disk, newest first. The recovery sweep's input. */
export function listRecordings(): RecordingManifest[] {
  const root = rootDirectory();
  if (!root.exists) return [];

  const manifests: RecordingManifest[] = [];
  for (const entry of root.list()) {
    if (!(entry instanceof Directory)) continue;
    const manifest = readManifest(entry.name);
    if (manifest) manifests.push(manifest);
  }
  manifests.sort((a, b) => b.createdAt - a.createdAt);
  return manifests;
}

/** Remove a recording and every segment under it. */
export function deleteRecording(localId: string): void {
  const dir = recordingDirectory(localId);
  if (dir.exists) dir.delete();
}
