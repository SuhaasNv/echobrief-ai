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
export const MeetingVisibility = z.enum(["private", "team"]);
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
export const MeetingSummary = z.object({
    id: uuidSchema,
    title: z.string(),
    status: MeetingStatus,
    duration_sec: z.number().int().nullable(),
    tags: z.array(z.string()),
    created_at: isoDateSchema,
    processed_at: isoDateSchema.nullable(),
    action_item_count: z.number().int().default(0),
    participant_count: z.number().int().default(0),
    summary_excerpt: z.string().nullable(),
});
export const MeetingListResponse = z.object({
    items: z.array(MeetingSummary),
    total: z.number().int(),
    page: z.number().int(),
    limit: z.number().int(),
});
export const UploadUrlRequest = z.object({
    filename: z.string().min(1).max(255),
    content_type: SupportedMime,
    size: z.number().int().positive().max(500 * 1024 * 1024), // 500MB
    duration_sec: z.number().int().positive().max(4 * 60 * 60).optional(),
    title: z.string().trim().min(1).max(200).optional(),
    language: z.string().min(2).max(10).default("en"),
    tags: z.array(z.string().trim().max(50)).max(10).default([]),
});
export const UploadUrlResponse = z.object({
    meeting_id: uuidSchema,
    upload_url: z.string().url(),
    audio_key: z.string(),
    expires_at: isoDateSchema,
});
export const ConfirmUploadRequest = z.object({
    meeting_id: uuidSchema,
});
export const MeetingPatchRequest = z
    .object({
    title: z.string().trim().min(1).max(200).optional(),
    tags: z.array(z.string().trim().max(50)).max(20).optional(),
    visibility: MeetingVisibility.optional(),
})
    .strict();
export const TranscriptSegment = z.object({
    speaker: z.string().nullable(),
    start_sec: z.number(),
    end_sec: z.number(),
    text: z.string(),
});
export const MeetingDetail = z.object({
    id: uuidSchema,
    title: z.string(),
    status: MeetingStatus,
    duration_sec: z.number().int().nullable(),
    language: z.string(),
    tags: z.array(z.string()),
    visibility: MeetingVisibility,
    share_token: z.string().nullable(),
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
        speakers: z.array(z.object({
            id: z.string(),
            label: z.string(),
            talk_time_sec: z.number(),
            word_count: z.number(),
        })),
    })
        .nullable(),
    summary: z
        .object({
        executive: z.string().nullable(),
        key_topics: z.array(z.string()),
        decisions: z.array(z.string()),
        open_questions: z.array(z.string()),
        chapters: z.array(z.object({
            title: z.string(),
            start_sec: z.number().int(),
            end_sec: z.number().int(),
            summary: z.string(),
        })),
    })
        .nullable(),
    created_at: isoDateSchema,
    processed_at: isoDateSchema.nullable(),
});
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
export const ActionItemPatchRequest = z
    .object({
    description: z.string().trim().min(1).max(500).optional(),
    assignee_name: z.string().trim().max(100).nullable().optional(),
    due_date: z.string().nullable().optional(),
    completed: z.boolean().optional(),
})
    .strict();
export const ActionItemExportRequest = z.object({
    provider: IntegrationProvider,
});
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
// ----------------------------------------------------------------------------
// Cross-meeting Search / RAG Q&A
// ----------------------------------------------------------------------------
export const SearchRequest = z.object({
    query: z.string().trim().min(1).max(500),
    history: z.array(ChatMessage).max(20).default([]),
    limit: z.number().int().min(1).max(20).default(10),
});
export const SearchCitation = z.object({
    meeting_id: uuidSchema,
    meeting_title: z.string(),
    start_sec: z.number().int(),
    end_sec: z.number().int(),
    excerpt: z.string(),
    similarity: z.number(),
});
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
// ----------------------------------------------------------------------------
// Account
// ----------------------------------------------------------------------------
export const UpdateProfileRequest = z
    .object({
    name: z.string().trim().min(1).max(100).optional(),
    avatar_url: z.string().url().optional(),
})
    .strict();
// ----------------------------------------------------------------------------
// Error envelope
// ----------------------------------------------------------------------------
export const ApiError = z.object({
    error: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
});
//# sourceMappingURL=schemas.js.map