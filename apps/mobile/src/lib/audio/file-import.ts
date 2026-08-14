import { getDocumentAsync } from "expo-document-picker";
import { File } from "expo-file-system";

/**
 * Choosing an audio file that already exists, and deciding whether we are
 * willing to send it.
 *
 * Everything here runs BEFORE a byte leaves the device, and that is the whole
 * reason the module exists. The API validates all of it again — UploadUrlRequest
 * in packages/shared/src/schemas.ts is the real gate — but the server cannot
 * answer until the presign, and the presign is the step that creates the meeting
 * row. A 400 arriving after a 200MB upload over cellular is a terrible way to
 * learn that a file was the wrong container.
 *
 * The one thing this module deliberately does NOT do is claim to know what the
 * bytes are. Nothing on the device can: the pipeline decodes the audio, and a
 * file mislabelled at the filesystem level fails there. What this decides is
 * what we DECLARE — the content type signed into the presigned PUT and stored on
 * the meeting row — and the value of deciding it here is that we declare one
 * thing consistently instead of two things that disagree.
 */

/**
 * Every content type the API accepts, mirrored from SupportedMime in
 * packages/shared/src/schemas.ts.
 *
 * Mirrored rather than imported, for the same reason MeetingSummary is mirrored
 * in lib/api/meetings.ts: the shared schemas are Zod, and pulling Zod into the
 * Metro bundle to read ten strings costs more than keeping ten strings honest.
 * The asymmetry is safe in the direction that matters — if this list falls
 * behind the server's, the app refuses a file the server would have taken; it
 * can never wave through one the server would refuse.
 */
const SUPPORTED_CONTENT_TYPES = [
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/aac",
  "audio/webm",
  "video/mp4",
  "video/webm",
] as const;

export type SupportedContentType = (typeof SUPPORTED_CONTENT_TYPES)[number];

function isSupportedContentType(value: string): value is SupportedContentType {
  return (SUPPORTED_CONTENT_TYPES as readonly string[]).includes(value);
}

/**
 * What the picker reports when the system could not identify the file at all.
 *
 * Not a guess on our part: DocumentPickerModule.swift resolves the type with
 * `UTType(filenameExtension:)?.preferredMIMEType` and hardcodes this string as
 * the `??` arm. So it means "no opinion", not "binary data".
 */
const UNIDENTIFIED_MIME = "application/octet-stream";

/**
 * Extension to content type, consulted ONLY when the system had no opinion.
 *
 * Deliberately narrower than SUPPORTED_CONTENT_TYPES: these are the extensions
 * that name exactly one container. There is no `.wave`, no `.m4b`, and no bare
 * `.bin`, because a guess we cannot defend is worse than a rejection the user
 * can act on.
 */
const EXTENSION_CONTENT_TYPES: Record<string, SupportedContentType> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/m4a",
  aac: "audio/aac",
  mp4: "video/mp4",
  webm: "audio/webm",
};

/** Extension for a synthesised filename. See `pickAudioFile`. */
const CONTENT_TYPE_EXTENSIONS: Record<SupportedContentType, string> = {
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/webm": "webm",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

/**
 * What the picker is allowed to show.
 *
 * MIME strings rather than UTIs because that is what expo-document-picker takes;
 * it maps `audio/*` to UTType.audio and the rest through `UTType(mimeType:)`,
 * dropping anything iOS does not know. A filter is a convenience, never a
 * control: a file provider can still hand back something else entirely, which is
 * why every check below runs on what actually arrives.
 */
const PICKER_TYPES = ["audio/*", "video/mp4", "video/webm"] as const;

/** UploadUrlRequest.size — `.max(500 * 1024 * 1024)`. */
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

/** UploadUrlRequest.filename — `.min(1).max(255)`. */
const MAX_FILENAME_CHARS = 255;

/** UploadUrlRequest.title — `.trim().min(1).max(200)`. */
export const MAX_TITLE_CHARS = 200;

/**
 * Mirrors sanitizeRecordedAt in src/server/api/routes/meetings.ts. A value
 * outside these bounds is dropped rather than corrected: the server drops it
 * too, and the meeting falls back to its upload time.
 */
const EARLIEST_PLAUSIBLE_RECORDING = Date.UTC(2000, 0, 1);
const FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;

/**
 * Truncate without splitting a surrogate pair.
 *
 * The server's limits are Zod `.max()`, which counts UTF-16 code units, so the
 * cut has to happen in the same units. A naive slice can land between the two
 * halves of an emoji and leave a lone surrogate, which JSON escapes happily and
 * Postgres then refuses as invalid UTF-8 — a 500 on a filename with a heart in
 * it.
 */
function capLength(value: string, max: number): string {
  if (value.length <= max) return value;

  const cut = value.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/**
 * Drop the characters that make a filename a weapon rather than a name.
 *
 * Written as a code-point scan rather than a character class because a regex
 * containing control characters is an eslint error (`no-control-regex`, on via
 * js.configs.recommended) — and because `for…of` iterates by code point, so a
 * surrogate pair is never inspected as two unrelated halves.
 *
 * Removed characters become a SPACE rather than nothing, so a control character
 * sitting between two words leaves two words instead of fusing them into one.
 */
function stripUnsafeCharacters(value: string): string {
  let out = "";

  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;

    // C0 controls and DEL, plus the C1 range. A newline inside a filename
    // becomes a newline inside a meeting title, which every list row renders.
    const control = code < 0x20 || (code >= 0x7f && code <= 0x9f);

    // Bidi overrides and isolates. A U+202E dropped in front of "gpm.exe"
    // makes the tail RENDER as "exe.mpg" — the extension a person reads stops
    // being the extension that is there. Nothing legitimate needs them in a
    // filename, and one is not written literally here because it would reorder
    // this comment too.
    const bidi = (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);

    out += control || bidi ? " " : char;
  }

  return out;
}

/**
 * The filename is untrusted input. It comes from a file provider we do not
 * control, it is sent to the API, it is stored on the meeting row, and when no
 * title is supplied the API derives the title from it — so it reaches the
 * meetings list, the share sheet, and every notification body.
 *
 * It does NOT reach the storage key. Verified rather than assumed: the server
 * mints that itself in POST /meetings/upload-url as
 * `buildAudioKey(user.id, meetingId, extensionFromMime(body.content_type))`, and
 * buildAudioKey (src/server/services/r2.ts) strips the extension down to
 * `[^a-z0-9]`. Nothing in the name can steer where an object lands. That is what
 * makes the rules below about legibility and storage rather than about path
 * traversal — but the separators are stripped anyway, because a rule that
 * depends on a remote file staying the way it is today is not a rule.
 */
export function sanitizeFilename(raw: string): string {
  // A filename is a leaf, never a path. A provider that answers
  // "../Documents/notes.m4a" is describing a location; we want the name.
  const leaf = raw.split(/[/\\]/).pop() ?? "";

  const cleaned = stripUnsafeCharacters(leaf).replace(/\s+/g, " ").trim();

  // Directory entries, not files.
  if (cleaned === "." || cleaned === "..") return "";

  return capLength(cleaned, MAX_FILENAME_CHARS);
}

/**
 * The meeting's opening title, from the filename.
 *
 * Only the last extension comes off, and only when it looks like one:
 * "Q3 review.mp3" loses ".mp3" while "2026.03.11 standup" keeps its dots.
 */
export function titleFromFilename(filename: string): string {
  return capLength(filename.replace(/\.[A-Za-z0-9]{1,8}$/, "").trim(), MAX_TITLE_CHARS);
}

/**
 * Which of the two signals decides the content type, and why it is the MIME.
 *
 * On iOS these are not two independent opinions. The picker does not read the
 * file — it reports `UTType(filenameExtension:)?.preferredMIMEType`, so its MIME
 * IS the system's own resolution of the extension. Preferring a table of ours
 * over that would mean overruling the platform's type database with a guess, and
 * then declaring to R2 something other than what we believe.
 *
 * So the MIME is authoritative, with one exception: `application/octet-stream`
 * is the module's literal "could not identify this" arm rather than a claim, and
 * there the extension is all there is. A specific type we do not support is
 * rejected even when the extension says `.mp3`, because content_type is what the
 * server validates and what the presigned PUT is signed with — sending
 * `audio/mpeg` for a file the system calls something else would be us inventing
 * a fact to get past a check.
 *
 * @returns null when the file cannot be declared as anything we support.
 */
export function resolveContentType(
  reported: string | undefined,
  filename: string,
): SupportedContentType | null {
  // Parameters and case are both legal in a media type and neither is part of
  // its identity: "audio/mpeg; charset=binary" is audio/mpeg.
  const mime = reported?.split(";")[0]?.trim().toLowerCase() ?? "";

  if (isSupportedContentType(mime)) return mime;
  if (mime !== "" && mime !== UNIDENTIFIED_MIME) return null;

  // `"recording".split(".").pop()` is "recording", so the dot has to be
  // confirmed before the tail can be treated as an extension.
  if (!filename.includes(".")) return null;

  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_CONTENT_TYPES[extension] ?? null;
}

/**
 * When the recording was made, if the file's own modification date is
 * believable.
 *
 * UploadUrlRequest documents `File.lastModified` as exactly this signal and
 * calls it best-effort, which it is: copying or re-saving a file rewrites it. On
 * iOS the picker falls back to `Date.now()` when the provider exposes no
 * modification date, so "today" is the common answer and is harmless — it is
 * what the server would have used anyway.
 */
export function recordedAtFromLastModified(lastModifiedMs: number): Date | null {
  if (!Number.isFinite(lastModifiedMs)) return null;
  if (lastModifiedMs < EARLIEST_PLAUSIBLE_RECORDING) return null;
  if (lastModifiedMs > Date.now() + FUTURE_SKEW_MS) return null;

  return new Date(lastModifiedMs);
}

export interface ImportedAudio {
  /** file:// URI of the copy in this app's cache directory. */
  uri: string;
  /** Sanitized. Sent to the API and stored on the meeting row. */
  filename: string;
  contentType: SupportedContentType;
  /** Bytes, measured from the local copy. See `pickAudioFile`. */
  size: number;
  recordedAt: Date | null;
  /** Opening value for the title field. Never empty. */
  suggestedTitle: string;
}

/** A file we will not send, and the sentence that says why. */
export interface ImportRejection {
  /** Short statement of the situation, matching ErrorCopy in lib/api/errors.ts. */
  title: string;
  body: string;
}

export type ImportOutcome =
  | { kind: "picked"; file: ImportedAudio }
  | { kind: "cancelled" }
  | { kind: "rejected"; reason: ImportRejection };

/** The formats worth naming when we have just refused one. */
const READABLE_FORMATS = "MP3, WAV, M4A, AAC, MP4 and WebM";

function reject(title: string, body: string): ImportOutcome {
  return { kind: "rejected", reason: { title, body } };
}

/**
 * Bytes as a person reads them: "4.2 MB", "812 KB".
 *
 * Base 1024 with the short units, which is what the 500 MB cap in
 * UploadUrlRequest is actually expressed in. Measuring in base 1000 instead
 * would print "524.3 MB" beside a "500 MB" limit for a file sitting exactly on
 * it, which reads as an off-by-one in our own error message.
 *
 * Here rather than in lib/format.ts, which exists to stop the list, the detail
 * screen and the recorder formatting the same value three ways. Nothing outside
 * importing a file has a byte count to show, and the base-1024 choice above is
 * only defensible next to the limit it is being compared against. It moves the
 * day a second caller appears.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;

  const megabytes = bytes / (1024 * 1024);
  if (megabytes < 1024) {
    // One decimal below 100 MB, none above: "4.2 MB" is informative, "412.7 MB"
    // is a serial number.
    return megabytes < 100 ? `${megabytes.toFixed(1)} MB` : `${Math.round(megabytes)} MB`;
  }

  return `${(megabytes / 1024).toFixed(1)} GB`;
}

/**
 * Present the system file browser and validate whatever comes back.
 *
 * Resolves rather than throws for a file we refuse: a rejection is a normal
 * outcome with a sentence attached, not an exception. Only the picker itself
 * failing to present throws.
 */
export async function pickAudioFile(): Promise<ImportOutcome> {
  const result = await getDocumentAsync({
    type: [...PICKER_TYPES],
    // Copied into this app's cache. Without the copy the URI points into the
    // provider's sandbox, where the upload task cannot open it and the byte
    // count below cannot be taken.
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled) return { kind: "cancelled" };

  // `multiple: false`, so there is exactly one — but the array is typed as an
  // array, and reading [0] under noUncheckedIndexedAccess has to admit that.
  const asset = result.assets[0];
  if (!asset) return { kind: "cancelled" };

  const filename = sanitizeFilename(asset.name);
  const contentType = resolveContentType(asset.mimeType, filename);

  if (!contentType) {
    const named = filename || "That file";
    const mime = asset.mimeType?.split(";")[0]?.trim().toLowerCase() ?? "";

    return mime === "" || mime === UNIDENTIFIED_MIME
      ? reject(
          "EchoBrief cannot tell what that file is",
          `iOS does not recognise the format of ${named}, and its name does not end in one EchoBrief transcribes. ${READABLE_FORMATS} all work.`,
        )
      : reject(
          "That is not a format EchoBrief can transcribe",
          `${named} is ${mime}. ${READABLE_FORMATS} all work.`,
        );
  }

  /**
   * Measured from the local copy, not taken from the picker.
   *
   * This number is signed into the presigned PUT as content-length, and the
   * bytes sent must match it exactly or R2 answers SignatureDoesNotMatch — see
   * the header of lib/audio/upload.ts. The picker measures the ORIGINAL, before
   * the copy; the uploader will read this same local file. Reading it from the
   * same place the uploader does is what keeps the two in step.
   */
  const local = new File(asset.uri);
  const size = local.exists ? (local.size ?? 0) : 0;

  if (size <= 0) {
    return reject(
      "That file is empty",
      `${filename || "The file"} has nothing in it, so there is no audio to transcribe.`,
    );
  }

  if (size > MAX_UPLOAD_BYTES) {
    return reject(
      "That file is too large",
      `${filename || "The file"} is ${formatBytes(size)}, and EchoBrief accepts recordings up to ${formatBytes(MAX_UPLOAD_BYTES)}. Splitting a long recording in two and adding each part works.`,
    );
  }

  // Everything above can strip a name down to nothing — a name that was only
  // control characters, or only a path. The API requires a non-empty filename,
  // and it is only a label here, so one is synthesised rather than refusing a
  // perfectly good recording over its name.
  const safeName = filename || `recording.${CONTENT_TYPE_EXTENSIONS[contentType]}`;

  return {
    kind: "picked",
    file: {
      uri: asset.uri,
      filename: safeName,
      contentType,
      size,
      recordedAt: recordedAtFromLastModified(asset.lastModified),
      suggestedTitle: titleFromFilename(safeName),
    },
  };
}
