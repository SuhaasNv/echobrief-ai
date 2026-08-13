/**
 * Shared Zod schemas — single source of truth for client + server API contracts.
 *
 * Server uses these to validate request bodies and query params.
 * Client uses the inferred types for type-safe API calls and forms.
 */

import { z } from "zod";

// ----------------------------------------------------------------------------
// Primitives
// ----------------------------------------------------------------------------
export const uuidSchema = z.string().uuid();
export const isoDateSchema = z.string().datetime({ offset: true });

export const MeetingStatus = z.enum([
  "queued",
  "transcribing",
  "analyzing",
  "indexing",
  "complete",
  "failed",
]);
export type MeetingStatus = z.infer<typeof MeetingStatus>;

export const MeetingVisibility = z.enum(["private", "team"]);
export type MeetingVisibility = z.infer<typeof MeetingVisibility>;

export const SupportedMime = z.enum([
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/webm",
  "video/mp4",
  "video/webm",
  /**
   * ADTS AAC. Added for segmented recording (see ConcatenableMime) and
   * accepted for plain uploads too — widening what the server will take can
   * never break a client that was already sending something else.
   */
  "audio/aac",
]);

export const IntegrationProvider = z.enum([
  "notion",
  "linear",
  "jira",
  "google_calendar",
  "trello",
]);
export type IntegrationProvider = z.infer<typeof IntegrationProvider>;

// ----------------------------------------------------------------------------
// Meetings — list, detail, upload, status
// ----------------------------------------------------------------------------
export const MeetingListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: MeetingStatus.optional(),
  q: z.string().trim().max(200).optional(),
  tag: z.string().trim().max(50).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});
export type MeetingListQuery = z.infer<typeof MeetingListQuery>;

export const MeetingSummary = z.object({
  id: uuidSchema,
  title: z.string(),
  status: MeetingStatus,
  duration_sec: z.number().int().nullable(),
  tags: z.array(z.string()),
  created_at: isoDateSchema,
  /** When the audio was recorded. NULL when unknown — fall back to created_at. */
  recorded_at: isoDateSchema.nullable().optional(),
  processed_at: isoDateSchema.nullable(),
  action_item_count: z.number().int().default(0),
  participant_count: z.number().int().default(0),
  summary_excerpt: z.string().nullable(),
  /**
   * Why this meeting matched the search, with matched terms wrapped in [[…]].
   * Only present on a search response, and null when only the title matched
   * (a title hit is self-evident from the title itself).
   */
  match_snippet: z.string().nullable().optional(),
});
export type MeetingSummary = z.infer<typeof MeetingSummary>;

export const MeetingListResponse = z.object({
  items: z.array(MeetingSummary),
  total: z.number().int(),
  page: z.number().int(),
  limit: z.number().int(),
});
export type MeetingListResponse = z.infer<typeof MeetingListResponse>;

export const UploadUrlRequest = z.object({
  filename: z.string().min(1).max(255),
  content_type: SupportedMime,
  size: z
    .number()
    .int()
    .positive()
    .max(500 * 1024 * 1024), // 500MB
  duration_sec: z
    .number()
    .int()
    .positive()
    .max(4 * 60 * 60)
    .optional(),
  title: z.string().trim().min(1).max(200).optional(),
  language: z.string().min(2).max(10).default("en"),
  tags: z.array(z.string().trim().max(50)).max(10).default([]),
  /**
   * When the audio was recorded, if the client can tell — the browser exposes
   * File.lastModified, which for most recorder exports is the recording time.
   * Best-effort, never trusted: copying or re-saving a file rewrites it, so a
   * value in the future or implausibly old is rejected server-side and the
   * meeting falls back to its upload time.
   */
  recorded_at: isoDateSchema.optional(),
});
export type UploadUrlRequest = z.infer<typeof UploadUrlRequest>;

export const UploadUrlResponse = z.object({
  meeting_id: uuidSchema,
  upload_url: z.string().url(),
  audio_key: z.string(),
  expires_at: isoDateSchema,
});
export type UploadUrlResponse = z.infer<typeof UploadUrlResponse>;

export const ConfirmUploadRequest = z.object({
  meeting_id: uuidSchema,
});

/**
 * Direct transcript upload — skips AssemblyAI. Server creates the meeting +
 * transcript rows and enqueues a processing job that goes straight to
 * analysis + embedding.
 */
export const TranscriptUploadRequest = z.object({
  title: z.string().trim().min(1).max(200),
  transcript_text: z
    .string()
    .trim()
    .min(50, "Transcript must be at least 50 characters")
    .max(500_000, "Transcript too large (500k char max)"),
  language: z.string().min(2).max(10).default("en"),
  tags: z.array(z.string().trim().max(50)).max(10).default([]),
});
export type TranscriptUploadRequest = z.infer<typeof TranscriptUploadRequest>;

export const TranscriptUploadResponse = z.object({
  meeting_id: uuidSchema,
  status: z.literal("queued"),
});
export type TranscriptUploadResponse = z.infer<typeof TranscriptUploadResponse>;

/**
 * Live-recording upload — sibling of TranscriptUpload that also includes the
 * R2 audio_key from the parallel MediaRecorder blob upload. The worker uses
 * the same "transcript already present" skip-AssemblyAI path.
 */
export const LiveUploadRequest = z.object({
  title: z.string().trim().min(1).max(200),
  transcript_text: z
    .string()
    .trim()
    .min(1, "Transcript is empty")
    .max(500_000, "Transcript too large (500k char max)"),
  audio_key: z.string().trim().min(1).max(500),
  audio_size: z
    .number()
    .int()
    .positive()
    .max(500 * 1024 * 1024),
  audio_mime: z.string().trim().min(1).max(100),
  duration_sec: z
    .number()
    .int()
    .nonnegative()
    .max(60 * 60 * 6),
  language: z.string().min(2).max(10).default("en"),
  tags: z.array(z.string().trim().max(50)).max(10).default([]),
});
export type LiveUploadRequest = z.infer<typeof LiveUploadRequest>;

// ----------------------------------------------------------------------------
// Segmented recording — crash-durable capture
// ----------------------------------------------------------------------------
/**
 * How often the recorder should rotate into a fresh file.
 *
 * This is the ceiling on what a crash costs. The old single-file recorder lost
 * the entire meeting, because an MPEG-4 container is unreadable until the
 * `moov` atom is written on stop; at 60 seconds the worst case is the segment
 * still open when the process died.
 *
 * Shorter is not free: every rotation is one presign, one PUT and one register
 * round-trip, and it inserts one AAC encoder priming gap (~30ms, measured)
 * into the joined audio. At 60s that drift is about 1.8s across an hour, which
 * is below the granularity anything downstream cares about. At 5s it would be
 * 21s of drift and 720 requests for the same meeting.
 */
export const SEGMENT_TARGET_SECONDS = 60;

/**
 * Per-segment size cap. 60s of speech AAC is well under 1MB; 32MB is a rail
 * against a client that never rotates, sized so it cannot be hit by a
 * correctly-behaving recorder at any sane bitrate.
 */
export const MAX_SEGMENT_BYTES = 32 * 1024 * 1024;

/** Mirrors the CHECK in migration 0016. ~17 hours at the 60s target. */
export const MAX_SEGMENTS_PER_MEETING = 1024;

/**
 * The containers a segmented recording may use.
 *
 * Deliberately a hard allowlist of one, and the single most important
 * constraint in this feature. Segments are rejoined by concatenating their
 * bytes, which is only valid for a format built from self-describing frames.
 * ADTS AAC is: every frame carries its own sample rate and channel config, so
 * a decoder reading a `cat` of two segments simply keeps going.
 *
 * MPEG-4 (.m4a) — what the recorder produced before this feature — is not, and
 * fails in the worst possible way. Measured end to end against AssemblyAI, a
 * byte-concatenated m4a of a 4.27s and a 4.55s clip returned `audio_duration:
 * 5`, `status: completed`, `error: null`, and a transcript containing only the
 * first clip. Half the meeting disappeared with no error anywhere. The
 * equivalent ADTS pair returned `audio_duration: 9` and both halves.
 *
 * That is why this is an allowlist rather than a denylist, and why the server
 * rejects the mime at registration rather than discovering it at join time: a
 * format that is not KNOWN to concatenate must never reach the worker, because
 * the failure does not raise, it just quietly loses audio.
 *
 * MP3 is byte-concatenable too and is still excluded — no mobile platform
 * encodes it natively, and an ID3 tag landing mid-stream is a hazard with no
 * upside here.
 *
 * Capture settings that produce this:
 *   iOS      ios.extension: ".aac", outputFormat: IOSOutputFormat.MPEG4AAC
 *            (AVAudioRecorder picks the container from the extension, and
 *            ".aac" selects ADTS rather than the MPEG-4 that ".m4a" gives)
 *   Android  android.outputFormat: "aac_adts", audioEncoder: "aac"
 */
export const ConcatenableMime = z.enum(["audio/aac"]);
export type ConcatenableMime = z.infer<typeof ConcatenableMime>;

/**
 * Open a segmented recording. Called once, when the user hits record — before
 * any audio exists — because segments need a meeting row to hang off.
 *
 * The meeting is created with a NULL audio_key: there is no single object yet,
 * and inventing the key early would make /audio-url sign URLs for something
 * that does not exist and make the retention sweep think it had audio to
 * delete. audio_key is filled in by the worker when the segments are joined,
 * after which the meeting is indistinguishable from a single-file upload.
 */
export const SegmentedRecordingRequest = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  /** Container for EVERY segment of this recording. Pinned here, not per segment. */
  content_type: ConcatenableMime,
  language: z.string().min(2).max(10).default("en"),
  tags: z.array(z.string().trim().max(50)).max(10).default([]),
  recorded_at: isoDateSchema.optional(),
});
export type SegmentedRecordingRequest = z.infer<typeof SegmentedRecordingRequest>;

export const SegmentedRecordingResponse = z.object({
  meeting_id: uuidSchema,
  status: z.literal("queued"),
  /**
   * Echoed back rather than left for the client to hardcode. The rotation
   * interval and the size cap are server policy; a client that baked in its
   * own copy would keep using the old one after the server changed its mind.
   */
  segment_target_seconds: z.number().int(),
  max_segment_bytes: z.number().int(),
});
export type SegmentedRecordingResponse = z.infer<typeof SegmentedRecordingResponse>;

/**
 * Presign a PUT for one segment.
 *
 * `size` is required because the presigned URL is signed WITH the content
 * length, so R2 rejects a PUT whose body is a different size. That is what
 * makes a truncated upload fail loudly at the bucket instead of registering as
 * a short segment and quietly clipping a minute out of the meeting.
 */
export const SegmentUploadUrlRequest = z.object({
  index: z
    .number()
    .int()
    .min(0)
    .max(MAX_SEGMENTS_PER_MEETING - 1),
  size: z.number().int().positive().max(MAX_SEGMENT_BYTES),
});
export type SegmentUploadUrlRequest = z.infer<typeof SegmentUploadUrlRequest>;

export const SegmentUploadUrlResponse = z.object({
  index: z.number().int(),
  upload_url: z.string().url(),
  audio_key: z.string(),
  expires_at: isoDateSchema,
});
export type SegmentUploadUrlResponse = z.infer<typeof SegmentUploadUrlResponse>;

/**
 * Register a segment the client has finished uploading.
 *
 * Carries only the index. The size is NOT accepted from the client: the server
 * reads it back from R2 with a HeadObject, which is both the proof the object
 * really landed and the only number the join can safely trust for its
 * Content-Length.
 */
export const SegmentRegisterRequest = z.object({
  index: z
    .number()
    .int()
    .min(0)
    .max(MAX_SEGMENTS_PER_MEETING - 1),
});
export type SegmentRegisterRequest = z.infer<typeof SegmentRegisterRequest>;

export const SegmentRegisterResponse = z.object({
  index: z.number().int(),
  /** Server-observed object size, from R2 rather than from the request. */
  bytes: z.number().int(),
  /** Segments registered for this meeting so far, this one included. */
  registered_count: z.number().int(),
});
export type SegmentRegisterResponse = z.infer<typeof SegmentRegisterResponse>;

/**
 * Close the recording and queue it for processing.
 *
 * `total_segments` is how the server tells "the recording was six segments
 * long" apart from "segments six and seven were lost". Without it a meeting
 * that dropped its last two uploads would look complete and would be
 * transcribed short, silently. Send the number the recorder actually rotated
 * through.
 *
 * Omit it only when recovering a recording whose own count did not survive the
 * crash. The server then assumes max(index)+1, which cannot detect a missing
 * tail — it still detects every gap in the middle.
 */
export const SegmentCompleteRequest = z.object({
  total_segments: z.number().int().min(1).max(MAX_SEGMENTS_PER_MEETING).optional(),
  /** Wall-clock length of the recording, if known. Refined by transcription. */
  duration_sec: z
    .number()
    .int()
    .nonnegative()
    .max(6 * 60 * 60)
    .optional(),
});
export type SegmentCompleteRequest = z.infer<typeof SegmentCompleteRequest>;

export const SegmentCompleteResponse = z.object({
  meeting_id: uuidSchema,
  status: z.literal("queued"),
  segment_count: z.number().int(),
  total_bytes: z.number().int(),
});
export type SegmentCompleteResponse = z.infer<typeof SegmentCompleteResponse>;

/**
 * 409 body when finalize finds holes. `missing` is machine-readable on purpose:
 * the client re-uploads exactly those indexes and calls complete again, which
 * is the whole recovery path. A prose-only error would leave it with nothing to
 * act on but a retry of the same broken request.
 */
export const SegmentGapError = z.object({
  error: z.literal("incomplete_segments"),
  message: z.string(),
  missing: z.array(z.number().int()),
  expected_total: z.number().int(),
});
export type SegmentGapError = z.infer<typeof SegmentGapError>;

export const MeetingPatchRequest = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    tags: z.array(z.string().trim().max(50)).max(20).optional(),
    visibility: MeetingVisibility.optional(),
  })
  .strict();
export type MeetingPatchRequest = z.infer<typeof MeetingPatchRequest>;

export const TranscriptSegment = z.object({
  speaker: z.string().nullable(),
  start_sec: z.number(),
  end_sec: z.number(),
  text: z.string(),
});

/**
 * Rename diarized voices: `{ "A": "Maya", "B": "David" }`.
 * Keys are the raw AssemblyAI labels. An empty value clears the name.
 */
export const SpeakerNamesRequest = z.object({
  names: z.record(z.string().min(1).max(8), z.string().trim().max(80)),
});
export type SpeakerNamesRequest = z.infer<typeof SpeakerNamesRequest>;

export const MeetingDetail = z.object({
  id: uuidSchema,
  title: z.string(),
  status: MeetingStatus,
  /** Why processing failed. The API has always returned these two; the schema
   *  just never declared them, so the failure UI couldn't show the reason. */
  failure_reason: z.string().nullable().optional(),
  retry_count: z.number().int().optional(),
  duration_sec: z.number().int().nullable(),
  language: z.string(),
  tags: z.array(z.string()),
  visibility: MeetingVisibility,
  share_token: z.string().nullable(),
  /** True if the meeting has an audio file in R2. False for pasted-transcript meetings. */
  has_audio: z.boolean(),
  /** True if the transcript was supplied by the client (paste OR live recording).
   *  Lets the UI hide the "Transcribed" processing step that never ran. */
  transcript_provided: z.boolean(),
  meeting_score: z
    .object({
      total: z.number(),
      participation: z.number(),
      actionability: z.number(),
      focus: z.number(),
      clarity: z.number(),
      efficiency: z.number(),
      explanation: z.string(),
    })
    .nullable(),
  transcript: z
    .object({
      raw_text: z.string(),
      segments: z.array(TranscriptSegment),
      speakers: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          talk_time_sec: z.number(),
          word_count: z.number(),
        }),
      ),
    })
    .nullable(),
  summary: z
    .object({
      executive: z.string().nullable(),
      key_topics: z.array(z.string()),
      decisions: z.array(z.string()),
      open_questions: z.array(z.string()),
      chapters: z.array(
        z.object({
          title: z.string(),
          start_sec: z.number().int(),
          end_sec: z.number().int(),
          summary: z.string(),
        }),
      ),
      /**
       * People the analysis is confident were actually in the conversation,
       * from what was said out loud.
       *
       * Optional because meetings analysed before this field existed are still
       * in the database and must still parse.
       */
      participants: z.array(z.string()).optional(),
    })
    .nullable(),
  created_at: isoDateSchema,
  processed_at: isoDateSchema.nullable(),
});
export type MeetingDetail = z.infer<typeof MeetingDetail>;

export const MeetingStatusResponse = z.object({
  id: uuidSchema,
  status: MeetingStatus,
  progress: z.object({
    uploaded: z.boolean(),
    transcribed: z.boolean(),
    analyzed: z.boolean(),
    indexed: z.boolean(),
  }),
  estimated_seconds_remaining: z.number().int().nullable(),
  failure_reason: z.string().nullable(),
});
export type MeetingStatusResponse = z.infer<typeof MeetingStatusResponse>;

// ----------------------------------------------------------------------------
// Action Items
// ----------------------------------------------------------------------------
export const ActionItem = z.object({
  id: uuidSchema,
  meeting_id: uuidSchema,
  meeting_title: z.string().optional(),
  description: z.string(),
  assignee_name: z.string().nullable(),
  assignee_id: uuidSchema.nullable(),
  due_date: z.string().nullable(),
  completed: z.boolean(),
  /**
   * When it was completed. NULL means "completed, date unknown" — rows finished
   * before the API recorded this were deliberately not backfilled (see
   * migration 0013), so clients must not present a date for them.
   */
  completed_at: isoDateSchema.nullable().optional(),
  timestamp_sec: z.number().int().nullable(),
  export_refs: z.record(z.string()).default({}),
  created_at: isoDateSchema,
  /** When the source meeting happened: COALESCE(recorded_at, created_at). */
  meeting_date: isoDateSchema.nullable().optional(),
});
export type ActionItem = z.infer<typeof ActionItem>;

export const ActionItemPatchRequest = z
  .object({
    description: z.string().trim().min(1).max(500).optional(),
    assignee_name: z.string().trim().max(100).nullable().optional(),
    due_date: z.string().nullable().optional(),
    completed: z.boolean().optional(),
  })
  .strict();
export type ActionItemPatchRequest = z.infer<typeof ActionItemPatchRequest>;

export const ActionItemExportRequest = z.object({
  provider: IntegrationProvider,
});
export type ActionItemExportRequest = z.infer<typeof ActionItemExportRequest>;

// ----------------------------------------------------------------------------
// Chat (per-meeting)
// ----------------------------------------------------------------------------
export const ChatMessage = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

export const MeetingChatRequest = z.object({
  message: z.string().trim().min(1).max(2000),
  history: z.array(ChatMessage).max(20).default([]),
});
export type MeetingChatRequest = z.infer<typeof MeetingChatRequest>;

// ----------------------------------------------------------------------------
// Cross-meeting Search / RAG Q&A
// ----------------------------------------------------------------------------
export const SearchRequest = z.object({
  query: z.string().trim().min(1).max(500),
  history: z.array(ChatMessage).max(20).default([]),
  limit: z.number().int().min(1).max(20).default(10),
});
export type SearchRequest = z.infer<typeof SearchRequest>;

export const SearchCitation = z.object({
  meeting_id: uuidSchema,
  meeting_title: z.string(),
  start_sec: z.number().int(),
  end_sec: z.number().int(),
  excerpt: z.string(),
  similarity: z.number(),
});
export type SearchCitation = z.infer<typeof SearchCitation>;

// ----------------------------------------------------------------------------
// Integrations
// ----------------------------------------------------------------------------
export const IntegrationStatus = z.object({
  provider: IntegrationProvider,
  connected: z.boolean(),
  workspace_name: z.string().nullable(),
  connected_at: isoDateSchema.nullable(),
});

export const OAuthCallbackQuery = z.object({
  code: z.string(),
  state: z.string(),
  error: z.string().optional(),
});

// ----------------------------------------------------------------------------
// Email Generation
// ----------------------------------------------------------------------------
export const EmailType = z.enum([
  "meeting_recap",
  "stakeholder_update",
  "sprint_summary",
  "action_item_assignment",
]);

export const EmailGenerationRequest = z.object({
  meeting_id: uuidSchema,
  type: EmailType,
  tone: z.enum(["professional", "casual"]).default("professional"),
});
export type EmailGenerationRequest = z.infer<typeof EmailGenerationRequest>;

// ----------------------------------------------------------------------------
// Account
// ----------------------------------------------------------------------------
/**
 * Avatar URLs accept three shapes:
 *   - A regular https:// URL (legacy / external avatars)
 *   - A `data:image/...;base64,...` data URL (client-side uploaded + resized)
 *   - `null` to clear the avatar back to initials
 *
 * Hard size cap is ~100KB on the request body — well above the typical
 * 15-30KB our client-side resize produces for a 256×256 JPEG.
 */
const AvatarUrlSchema = z
  .union([
    z.string().url(),
    z.string().regex(/^data:image\/(jpeg|png|webp|gif);base64,/i, "Invalid data URL"),
    z.null(),
  ])
  .refine((v) => v === null || v.length <= 100_000, {
    message: "Avatar image too large (max ~100KB after resize)",
  });

export const UpdateProfileRequest = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    avatar_url: AvatarUrlSchema.optional(),
  })
  .strict();
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequest>;

// ----------------------------------------------------------------------------
// Account — pipeline preferences
// ----------------------------------------------------------------------------
/**
 * How long audio survives when the user has expressed no preference.
 *
 * Exported rather than written as a literal in three places because it already
 * drifted once: the cleanup worker deleted audio at 7 days flat while the
 * settings screen offered windows up to 90 and told people their choice was
 * honoured. Every surface that states a number — the worker, the API's GET
 * response, the iOS copy — reads it from here.
 */
export const DEFAULT_AUDIO_RETENTION_DAYS = 7;

/** The longest retention window the API will store. See migration 0015. */
export const MAX_AUDIO_RETENTION_DAYS = 365;

/** Mirrors MAX_VOCABULARY_TERMS on iOS and the CHECK in migration 0015. */
export const MAX_VOCABULARY_TERMS = 100;

/**
 * A transcription language, or `"auto"` for AssemblyAI's language detection.
 *
 * The pattern is deliberately wider than the picker: AssemblyAI accepts plain
 * codes ("en", "fr") and regional ones ("en_us", "pt_br"), and a stricter rule
 * here would reject a language the vendor supports for no gain.
 */
export const TranscriptionLanguage = z.union([
  z.literal("auto"),
  z.string().regex(/^[a-z]{2,3}(_[a-zA-Z0-9]{2,4})?$/, "Not a supported language code"),
]);
export type TranscriptionLanguage = z.infer<typeof TranscriptionLanguage>;

/**
 * Preferences that reach the processing pipeline.
 *
 * `null` on any field means "never chosen", and the server falls back to the
 * behaviour that shipped before preferences existed. That is distinct from
 * `"auto"` on the language, which is an expressed choice to let the transcriber
 * decide — see migration 0015 for why the two cannot share NULL.
 */
/**
 * How summaries are written. Each is nullable and null means "never chosen",
 * which the pipeline deliberately does NOT treat as choosing the default — an
 * unset value contributes no instruction, so output is unchanged for anyone who
 * has not opened these settings.
 */
export const SummaryStyle = z.enum(["executive", "detailed", "bullets", "decisions"]);
export type SummaryStyle = z.infer<typeof SummaryStyle>;
export const SummaryLength = z.enum(["short", "standard", "long"]);
export type SummaryLength = z.infer<typeof SummaryLength>;
export const SummaryTone = z.enum(["neutral", "direct", "warm"]);
export type SummaryTone = z.infer<typeof SummaryTone>;

export const UserPreferences = z.object({
  transcription_language: TranscriptionLanguage.nullable(),
  vocabulary: z.array(z.string()),
  /** Days. `0` means keep until deleted by hand; `null` means use the default. */
  audio_retention_days: z.number().int().nullable(),
  /**
   * What `audio_retention_days: null` resolves to. Returned so a client can
   * label the unset state with the real number instead of hardcoding one and
   * being wrong the next time the worker changes.
   */
  default_audio_retention_days: z.number().int(),
  summary_style: SummaryStyle.nullable(),
  summary_length: SummaryLength.nullable(),
  summary_tone: SummaryTone.nullable(),
  detect_action_items: z.boolean(),
  /**
   * Ask AssemblyAI to return the transcript with profanity masked.
   *
   * Not nullable, and false by default: filtering has always been off, and
   * "never chosen" and "off" are the same behaviour here — see migration 0019
   * for why a lossy transcript is not something to opt a user into silently.
   * It applies when the audio is transcribed, so it never changes a meeting
   * that already has a transcript.
   */
  filter_profanity: z.boolean(),
});
export type UserPreferences = z.infer<typeof UserPreferences>;

export const UpdatePreferencesRequest = z
  .object({
    transcription_language: TranscriptionLanguage.nullable().optional(),
    /**
     * Replaces the whole list — there is no add/remove endpoint, because the
     * client already holds the list and a partial update would need conflict
     * rules for a 100-item array that two devices can both edit.
     */
    vocabulary: z.array(z.string().trim().min(1).max(80)).max(MAX_VOCABULARY_TERMS).optional(),
    audio_retention_days: z
      .number()
      .int()
      .min(0)
      .max(MAX_AUDIO_RETENTION_DAYS)
      .nullable()
      .optional(),
    summary_style: SummaryStyle.nullable().optional(),
    summary_length: SummaryLength.nullable().optional(),
    summary_tone: SummaryTone.nullable().optional(),
    detect_action_items: z.boolean().optional(),
    filter_profanity: z.boolean().optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "Provide at least one preference to update",
  });
export type UpdatePreferencesRequest = z.infer<typeof UpdatePreferencesRequest>;

// ----------------------------------------------------------------------------
// Error envelope
// ----------------------------------------------------------------------------
export const ApiError = z.object({
  error: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof ApiError>;
