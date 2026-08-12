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
  timestamp_sec: z.number().int().nullable(),
  export_refs: z.record(z.string()).default({}),
  created_at: isoDateSchema,
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
// Error envelope
// ----------------------------------------------------------------------------
export const ApiError = z.object({
  error: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof ApiError>;
