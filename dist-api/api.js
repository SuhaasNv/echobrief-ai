var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/server/env.ts
var env_exports = {};
__export(env_exports, {
  getApiPublicOrigin: () => getApiPublicOrigin,
  getEnv: () => getEnv
});
import { z } from "zod";
function getEnv() {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment configuration");
  }
  cached = parsed.data;
  return cached;
}
function stripTrailingSlashes(origin) {
  return origin.replace(/\/+$/, "");
}
function getApiPublicOrigin() {
  const env2 = getEnv();
  return stripTrailingSlashes(env2.API_PUBLIC_URL ?? env2.APP_URL);
}
var EnvSchema, cached;
var init_env = __esm({
  "src/server/env.ts"() {
    "use strict";
    EnvSchema = z.object({
      NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
      APP_URL: z.string().url().default("http://localhost:3000"),
      /**
       * Public origin where this API is reachable (no trailing path). Omit when the SPA
       * and API share APP_URL; set when API is separate (Railway subdomain, local :4001, etc.).
       */
      API_PUBLIC_URL: z.preprocess(
        (val) => val === "" || val === void 0 || val === null || typeof val === "string" && val.trim() === "" ? void 0 : val,
        z.string().url().optional()
      ),
      PORT: z.coerce.number().int().default(3e3),
      // --- Data layer (Railway) ---
      DATABASE_URL: z.string().min(1),
      REDIS_URL: z.string().min(1),
      /** Set true only for Postgres without TLS (e.g. local Docker). Keep false on Railway. */
      DATABASE_SSL_DISABLED: z.coerce.boolean().default(false),
      // --- Auth (Better Auth) ---
      BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be 32+ chars"),
      BETTER_AUTH_URL: z.string().url().optional(),
      // Optional Google OAuth for Better Auth
      GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
      GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
      // --- AI providers ---
      // AssemblyAI handles transcription + speaker diarization (incl. the live
      // voice-agent pipeline in V3). OpenAI handles LLM (GPT-5) + embeddings.
      ASSEMBLYAI_API_KEY: z.string().optional(),
      OPENAI_API_KEY: z.string().optional(),
      OPENAI_MODEL_PRIMARY: z.string().default("gpt-5"),
      OPENAI_MODEL_LIGHT: z.string().default("gpt-5-mini"),
      // --- Email ---
      RESEND_API_KEY: z.string().optional(),
      // --- Audio storage (Cloudflare R2 / S3-compatible) ---
      R2_ACCOUNT_ID: z.string().optional(),
      R2_ACCESS_KEY_ID: z.string().optional(),
      R2_SECRET_ACCESS_KEY: z.string().optional(),
      R2_BUCKET: z.string().default("echobrief-audio"),
      R2_PUBLIC_BASE_URL: z.string().url().optional(),
      // --- Integration token encryption ---
      INTEGRATION_TOKEN_ENCRYPTION_KEY: z.string().min(44).optional(),
      // --- Integration OAuth (V2) ---
      NOTION_CLIENT_ID: z.string().optional(),
      NOTION_CLIENT_SECRET: z.string().optional(),
      LINEAR_CLIENT_ID: z.string().optional(),
      LINEAR_CLIENT_SECRET: z.string().optional(),
      GOOGLE_CLIENT_ID: z.string().optional(),
      GOOGLE_CLIENT_SECRET: z.string().optional()
    });
    cached = null;
  }
});

// src/api.ts
import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono as Hono10 } from "hono";

// src/server/api/index.ts
import { Hono as Hono9 } from "hono";
import { cors } from "hono/cors";

// src/server/api/middleware/request-id.ts
var requestId = async (c, next) => {
  const id = c.req.header("x-request-id") ?? crypto.randomUUID();
  c.set("requestId", id);
  c.header("x-request-id", id);
  await next();
};

// src/server/api/middleware/error.ts
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
var errorHandler = (err, c) => {
  if (err instanceof HTTPException) {
    return c.json(
      {
        error: "http_error",
        message: err.message
      },
      err.status
    );
  }
  if (err instanceof ZodError) {
    return c.json(
      {
        error: "validation_error",
        message: "Request validation failed",
        details: err.flatten()
      },
      400
    );
  }
  console.error("[unhandled-error]", err);
  return c.json(
    {
      error: "internal_error",
      message: "An unexpected error occurred"
    },
    500
  );
};

// src/server/api/middleware/auth.ts
init_env();
import { jwtVerify } from "jose";
var requireAuth = async (c, next) => {
  const authHeader = c.req.header("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "unauthorized", message: "Missing bearer token" }, 401);
  }
  const jwt = authHeader.slice("Bearer ".length).trim();
  if (!jwt) {
    return c.json({ error: "unauthorized", message: "Empty bearer token" }, 401);
  }
  const env2 = getEnv();
  const secret = new TextEncoder().encode(env2.BETTER_AUTH_SECRET);
  try {
    const { payload } = await jwtVerify(jwt, secret, {
      // Accept HS256 by default; tighten if Better Auth rotates algorithms.
      algorithms: ["HS256"]
    });
    if (typeof payload.sub !== "string") {
      return c.json({ error: "unauthorized", message: "Token missing subject" }, 401);
    }
    c.set("user", {
      id: payload.sub,
      email: typeof payload.email === "string" ? payload.email : "",
      jwt
    });
    await next();
  } catch (err) {
    return c.json(
      {
        error: "unauthorized",
        message: err instanceof Error ? err.message : "Invalid token"
      },
      401
    );
  }
};

// src/server/services/redis.ts
init_env();
import Redis from "ioredis";
var _redis = null;
function getRedis() {
  if (_redis) return _redis;
  const env2 = getEnv();
  _redis = new Redis(env2.REDIS_URL, {
    maxRetriesPerRequest: null,
    // required for BullMQ-compatible clients
    enableReadyCheck: false,
    lazyConnect: false
  });
  _redis.on("error", (err) => {
    console.error("[redis-error]", err.message);
  });
  return _redis;
}
async function closeRedis() {
  if (_redis) {
    await _redis.quit();
    _redis = null;
  }
}

// src/server/api/middleware/rate-limit.ts
var LIMITS = {
  general: { max: 100, window_sec: 60 },
  ai: { max: 10, window_sec: 60 }
};
function rateLimit(bucket) {
  return async (c, next) => {
    const { max, window_sec } = LIMITS[bucket];
    const user = c.get("user");
    const identifier = user?.id ?? c.req.header("x-forwarded-for") ?? c.req.header("cf-connecting-ip") ?? "anonymous";
    const windowStart = Math.floor(Date.now() / 1e3 / window_sec);
    const key = `ratelimit:${identifier}:${bucket}:${windowStart}`;
    const redis = getRedis();
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, window_sec * 2);
    }
    if (count > max) {
      return c.json(
        {
          error: "rate_limited",
          message: `Too many requests. Limit: ${max} per ${window_sec}s.`
        },
        429,
        { "Retry-After": String(window_sec) }
      );
    }
    await next();
  };
}

// src/server/api/index.ts
init_env();

// src/server/api/routes/meetings.ts
import { Hono } from "hono";
import { HTTPException as HTTPException2 } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { z as z3 } from "zod";
import { randomUUID, randomBytes } from "node:crypto";

// src/lib/schemas.ts
import { z as z2 } from "zod";
var uuidSchema = z2.string().uuid();
var isoDateSchema = z2.string().datetime({ offset: true });
var MeetingStatus = z2.enum([
  "queued",
  "transcribing",
  "analyzing",
  "indexing",
  "complete",
  "failed"
]);
var MeetingVisibility = z2.enum(["private", "team"]);
var SupportedMime = z2.enum([
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/webm",
  "video/mp4",
  "video/webm"
]);
var IntegrationProvider = z2.enum([
  "notion",
  "linear",
  "jira",
  "google_calendar",
  "trello"
]);
var MeetingListQuery = z2.object({
  page: z2.coerce.number().int().min(1).default(1),
  limit: z2.coerce.number().int().min(1).max(100).default(20),
  status: MeetingStatus.optional(),
  q: z2.string().trim().max(200).optional(),
  tag: z2.string().trim().max(50).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional()
});
var MeetingSummary = z2.object({
  id: uuidSchema,
  title: z2.string(),
  status: MeetingStatus,
  duration_sec: z2.number().int().nullable(),
  tags: z2.array(z2.string()),
  created_at: isoDateSchema,
  processed_at: isoDateSchema.nullable(),
  action_item_count: z2.number().int().default(0),
  participant_count: z2.number().int().default(0),
  summary_excerpt: z2.string().nullable()
});
var MeetingListResponse = z2.object({
  items: z2.array(MeetingSummary),
  total: z2.number().int(),
  page: z2.number().int(),
  limit: z2.number().int()
});
var UploadUrlRequest = z2.object({
  filename: z2.string().min(1).max(255),
  content_type: SupportedMime,
  size: z2.number().int().positive().max(500 * 1024 * 1024),
  // 500MB
  duration_sec: z2.number().int().positive().max(4 * 60 * 60).optional(),
  title: z2.string().trim().min(1).max(200).optional(),
  language: z2.string().min(2).max(10).default("en"),
  tags: z2.array(z2.string().trim().max(50)).max(10).default([])
});
var UploadUrlResponse = z2.object({
  meeting_id: uuidSchema,
  upload_url: z2.string().url(),
  audio_key: z2.string(),
  expires_at: isoDateSchema
});
var ConfirmUploadRequest = z2.object({
  meeting_id: uuidSchema
});
var MeetingPatchRequest = z2.object({
  title: z2.string().trim().min(1).max(200).optional(),
  tags: z2.array(z2.string().trim().max(50)).max(20).optional(),
  visibility: MeetingVisibility.optional()
}).strict();
var TranscriptSegment = z2.object({
  speaker: z2.string().nullable(),
  start_sec: z2.number(),
  end_sec: z2.number(),
  text: z2.string()
});
var MeetingDetail = z2.object({
  id: uuidSchema,
  title: z2.string(),
  status: MeetingStatus,
  duration_sec: z2.number().int().nullable(),
  language: z2.string(),
  tags: z2.array(z2.string()),
  visibility: MeetingVisibility,
  share_token: z2.string().nullable(),
  meeting_score: z2.object({
    total: z2.number(),
    participation: z2.number(),
    actionability: z2.number(),
    focus: z2.number(),
    clarity: z2.number(),
    efficiency: z2.number(),
    explanation: z2.string()
  }).nullable(),
  transcript: z2.object({
    raw_text: z2.string(),
    segments: z2.array(TranscriptSegment),
    speakers: z2.array(
      z2.object({
        id: z2.string(),
        label: z2.string(),
        talk_time_sec: z2.number(),
        word_count: z2.number()
      })
    )
  }).nullable(),
  summary: z2.object({
    executive: z2.string().nullable(),
    key_topics: z2.array(z2.string()),
    decisions: z2.array(z2.string()),
    open_questions: z2.array(z2.string()),
    chapters: z2.array(
      z2.object({
        title: z2.string(),
        start_sec: z2.number().int(),
        end_sec: z2.number().int(),
        summary: z2.string()
      })
    )
  }).nullable(),
  created_at: isoDateSchema,
  processed_at: isoDateSchema.nullable()
});
var MeetingStatusResponse = z2.object({
  id: uuidSchema,
  status: MeetingStatus,
  progress: z2.object({
    uploaded: z2.boolean(),
    transcribed: z2.boolean(),
    analyzed: z2.boolean(),
    indexed: z2.boolean()
  }),
  estimated_seconds_remaining: z2.number().int().nullable(),
  failure_reason: z2.string().nullable()
});
var ActionItem = z2.object({
  id: uuidSchema,
  meeting_id: uuidSchema,
  meeting_title: z2.string().optional(),
  description: z2.string(),
  assignee_name: z2.string().nullable(),
  assignee_id: uuidSchema.nullable(),
  due_date: z2.string().nullable(),
  completed: z2.boolean(),
  timestamp_sec: z2.number().int().nullable(),
  export_refs: z2.record(z2.string()).default({}),
  created_at: isoDateSchema
});
var ActionItemPatchRequest = z2.object({
  description: z2.string().trim().min(1).max(500).optional(),
  assignee_name: z2.string().trim().max(100).nullable().optional(),
  due_date: z2.string().nullable().optional(),
  completed: z2.boolean().optional()
}).strict();
var ActionItemExportRequest = z2.object({
  provider: IntegrationProvider
});
var ChatMessage = z2.object({
  role: z2.enum(["user", "assistant"]),
  content: z2.string()
});
var MeetingChatRequest = z2.object({
  message: z2.string().trim().min(1).max(2e3),
  history: z2.array(ChatMessage).max(20).default([])
});
var SearchRequest = z2.object({
  query: z2.string().trim().min(1).max(500),
  history: z2.array(ChatMessage).max(20).default([]),
  limit: z2.number().int().min(1).max(20).default(10)
});
var SearchCitation = z2.object({
  meeting_id: uuidSchema,
  meeting_title: z2.string(),
  start_sec: z2.number().int(),
  end_sec: z2.number().int(),
  excerpt: z2.string(),
  similarity: z2.number()
});
var IntegrationStatus = z2.object({
  provider: IntegrationProvider,
  connected: z2.boolean(),
  workspace_name: z2.string().nullable(),
  connected_at: isoDateSchema.nullable()
});
var OAuthCallbackQuery = z2.object({
  code: z2.string(),
  state: z2.string(),
  error: z2.string().optional()
});
var EmailType = z2.enum([
  "meeting_recap",
  "stakeholder_update",
  "sprint_summary",
  "action_item_assignment"
]);
var EmailGenerationRequest = z2.object({
  meeting_id: uuidSchema,
  type: EmailType,
  tone: z2.enum(["professional", "casual"]).default("professional")
});
var UpdateProfileRequest = z2.object({
  name: z2.string().trim().min(1).max(100).optional(),
  avatar_url: z2.string().url().optional()
}).strict();
var ApiError = z2.object({
  error: z2.string(),
  message: z2.string(),
  details: z2.unknown().optional()
});

// src/server/services/r2.ts
init_env();
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
var PRESIGN_TTL_SECONDS = 60 * 60;
var _client = null;
function getClient() {
  if (_client) return _client;
  const env2 = getEnv();
  if (!env2.R2_ACCOUNT_ID || !env2.R2_ACCESS_KEY_ID || !env2.R2_SECRET_ACCESS_KEY) {
    throw new Error("R2 credentials not configured (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)");
  }
  _client = new S3Client({
    region: "auto",
    endpoint: `https://${env2.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env2.R2_ACCESS_KEY_ID,
      secretAccessKey: env2.R2_SECRET_ACCESS_KEY
    }
  });
  return _client;
}
function buildAudioKey(userId, meetingId, ext) {
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  return `${userId}/${meetingId}/original.${safeExt}`;
}
function extensionFromMime(mime) {
  const map = {
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/mp4": "m4a",
    "audio/m4a": "m4a",
    "audio/x-m4a": "m4a",
    "audio/webm": "webm",
    "video/mp4": "mp4",
    "video/webm": "webm"
  };
  return map[mime] ?? "bin";
}
async function createPresignedUploadUrl(audioKey, contentType, contentLength) {
  const env2 = getEnv();
  const cmd = new PutObjectCommand({
    Bucket: env2.R2_BUCKET,
    Key: audioKey,
    ContentType: contentType,
    ContentLength: contentLength
  });
  const upload_url = await getSignedUrl(getClient(), cmd, {
    expiresIn: PRESIGN_TTL_SECONDS
  });
  const expires_at = new Date(Date.now() + PRESIGN_TTL_SECONDS * 1e3).toISOString();
  return { upload_url, expires_at };
}
async function deleteAudioObject(audioKey) {
  const env2 = getEnv();
  await getClient().send(
    new DeleteObjectCommand({
      Bucket: env2.R2_BUCKET,
      Key: audioKey
    })
  );
}

// src/server/services/queue.ts
init_env();
import { Queue } from "bullmq";
import Redis2 from "ioredis";
var PROCESSING_QUEUE_NAME = "processing";
var _connection = null;
var _queue = null;
function getConnection() {
  if (_connection) return _connection;
  const env2 = getEnv();
  _connection = new Redis2(env2.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false
  });
  return _connection;
}
function getProcessingQueue() {
  if (_queue) return _queue;
  _queue = new Queue(PROCESSING_QUEUE_NAME, {
    connection: getConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 3e4 },
      removeOnComplete: { count: 1e3, age: 60 * 60 * 24 * 7 },
      removeOnFail: { count: 500, age: 60 * 60 * 24 * 30 }
    }
  });
  return _queue;
}
async function enqueueProcessingJob(job) {
  const queue = getProcessingQueue();
  await queue.add(`meeting:${job.meeting_id}`, job, {
    jobId: job.meeting_id
    // idempotent: re-enqueues are deduped by job id
  });
}
async function closeQueue() {
  if (_queue) {
    await _queue.close();
    _queue = null;
  }
  if (_connection && "quit" in _connection) {
    await _connection.quit();
    _connection = null;
  }
}

// src/server/db/index.ts
init_env();
import postgres from "postgres";
var _sql = null;
function getSql() {
  if (_sql) return _sql;
  const env2 = getEnv();
  _sql = postgres(env2.DATABASE_URL, {
    ssl: env2.DATABASE_SSL_DISABLED ? false : "require",
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
    prepare: false
  });
  return _sql;
}
async function closeSql() {
  if (_sql) {
    await _sql.end({ timeout: 5 });
    _sql = null;
  }
}

// src/server/api/routes/meetings.ts
var app = new Hono();
app.post("/upload-url", zValidator("json", UploadUrlRequest), async (c) => {
  const body = c.req.valid("json");
  const user = c.get("user");
  const sql = getSql();
  const meetingId = randomUUID();
  const ext = extensionFromMime(body.content_type);
  const audioKey = buildAudioKey(user.id, meetingId, ext);
  await sql`
    INSERT INTO meetings (
      id, user_id, title, audio_key, audio_size, audio_mime,
      duration_sec, language, tags, status
    ) VALUES (
      ${meetingId},
      ${user.id},
      ${body.title ?? body.filename.replace(/\.[^.]+$/, "")},
      ${audioKey},
      ${body.size},
      ${body.content_type},
      ${body.duration_sec ?? null},
      ${body.language},
      ${sql.array(body.tags)},
      'queued'
    )
  `;
  const { upload_url, expires_at } = await createPresignedUploadUrl(
    audioKey,
    body.content_type,
    body.size
  );
  return c.json(
    UploadUrlResponse.parse({
      meeting_id: meetingId,
      upload_url,
      audio_key: audioKey,
      expires_at
    })
  );
});
app.post("/", zValidator("json", ConfirmUploadRequest), async (c) => {
  const { meeting_id } = c.req.valid("json");
  const user = c.get("user");
  const sql = getSql();
  const rows = await sql`
    SELECT id, user_id, audio_key, language, status
    FROM meetings
    WHERE id = ${meeting_id} AND user_id = ${user.id}
  `;
  const meeting = rows[0];
  if (!meeting) throw new HTTPException2(404, { message: "Meeting not found" });
  if (!meeting.audio_key) throw new HTTPException2(400, { message: "Meeting has no audio key" });
  await enqueueProcessingJob({
    meeting_id: meeting.id,
    user_id: meeting.user_id,
    audio_key: meeting.audio_key,
    language: meeting.language,
    retry_count: 0
  });
  return c.json({ meeting_id, status: "queued" });
});
app.get("/", zValidator("query", MeetingListQuery), async (c) => {
  const q = c.req.valid("query");
  const user = c.get("user");
  const sql = getSql();
  const offset = (q.page - 1) * q.limit;
  const conditions = [sql`user_id = ${user.id}`];
  if (q.status) conditions.push(sql`status = ${q.status}`);
  if (q.tag) conditions.push(sql`${q.tag} = ANY(tags)`);
  if (q.from) conditions.push(sql`created_at >= ${q.from}`);
  if (q.to) conditions.push(sql`created_at <= ${q.to}`);
  if (q.q) conditions.push(sql`title ILIKE ${`%${q.q}%`}`);
  const whereClause = conditions.reduce(
    (acc, cur, i) => i === 0 ? cur : sql`${acc} AND ${cur}`
  );
  const rows = await sql`
    SELECT
      m.id,
      m.title,
      m.status,
      m.duration_sec,
      m.tags,
      m.created_at,
      m.processed_at,
      s.executive AS summary_excerpt,
      (SELECT COUNT(*)::int FROM action_items ai WHERE ai.meeting_id = m.id) AS action_item_count
    FROM meetings m
    LEFT JOIN summaries s ON s.meeting_id = m.id
    WHERE ${whereClause}
    ORDER BY m.created_at DESC
    LIMIT ${q.limit} OFFSET ${offset}
  `;
  const [{ total }] = await sql`
    SELECT COUNT(*)::int AS total FROM meetings WHERE ${whereClause}
  `;
  return c.json({
    items: rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      duration_sec: r.duration_sec,
      tags: r.tags ?? [],
      created_at: r.created_at,
      processed_at: r.processed_at,
      action_item_count: r.action_item_count,
      participant_count: 0,
      summary_excerpt: r.summary_excerpt
    })),
    total,
    page: q.page,
    limit: q.limit
  });
});
app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const sql = getSql();
  const meetings = await sql`
    SELECT * FROM meetings WHERE id = ${id} AND user_id = ${user.id}
  `;
  const meeting = meetings[0];
  if (!meeting) throw new HTTPException2(404, { message: "Meeting not found" });
  const [transcript] = await sql`SELECT raw_text, content, speakers FROM transcripts WHERE meeting_id = ${id}`;
  const [summary] = await sql`SELECT executive, key_topics, decisions, open_questions, chapters
    FROM summaries WHERE meeting_id = ${id}`;
  return c.json({ ...meeting, transcript: transcript ?? null, summary: summary ?? null });
});
app.patch("/:id", zValidator("json", MeetingPatchRequest), async (c) => {
  const id = c.req.param("id");
  const patch = c.req.valid("json");
  const user = c.get("user");
  const sql = getSql();
  const sets = [];
  if (patch.title !== void 0) sets.push(sql`title = ${patch.title}`);
  if (patch.tags !== void 0) sets.push(sql`tags = ${sql.array(patch.tags)}`);
  if (patch.visibility !== void 0) sets.push(sql`visibility = ${patch.visibility}`);
  if (sets.length === 0) return c.json({ ok: true });
  const setClause = sets.reduce((acc, cur, i) => i === 0 ? cur : sql`${acc}, ${cur}`);
  await sql`UPDATE meetings SET ${setClause} WHERE id = ${id} AND user_id = ${user.id}`;
  return c.json({ ok: true });
});
app.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const sql = getSql();
  const rows = await sql`SELECT audio_key FROM meetings WHERE id = ${id} AND user_id = ${user.id}`;
  const row = rows[0];
  if (!row) throw new HTTPException2(404, { message: "Meeting not found" });
  if (row.audio_key) {
    await deleteAudioObject(row.audio_key).catch((e) => console.error("[r2-delete]", e));
  }
  await sql`DELETE FROM meetings WHERE id = ${id} AND user_id = ${user.id}`;
  return c.json({ ok: true });
});
app.get("/:id/status", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const sql = getSql();
  const rows = await sql`
    SELECT id, status, failure_reason, duration_sec, audio_key
    FROM meetings WHERE id = ${id} AND user_id = ${user.id}
  `;
  const data = rows[0];
  if (!data) throw new HTTPException2(404, { message: "Meeting not found" });
  const progress = {
    uploaded: data.audio_key !== null,
    transcribed: ["analyzing", "indexing", "complete"].includes(data.status),
    analyzed: ["indexing", "complete"].includes(data.status),
    indexed: data.status === "complete"
  };
  const estimated = data.status === "complete" ? 0 : data.duration_sec ? Math.max(30, Math.floor(data.duration_sec / 20)) : null;
  return c.json(
    MeetingStatusResponse.parse({
      id: data.id,
      status: data.status,
      progress,
      estimated_seconds_remaining: estimated,
      failure_reason: data.failure_reason
    })
  );
});
app.post("/:id/retry", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const sql = getSql();
  const rows = await sql`
    SELECT id, user_id, audio_key, language, status, retry_count
    FROM meetings WHERE id = ${id} AND user_id = ${user.id}
  `;
  const meeting = rows[0];
  if (!meeting) throw new HTTPException2(404, { message: "Meeting not found" });
  if (meeting.status !== "failed") {
    throw new HTTPException2(400, { message: "Meeting is not in a failed state" });
  }
  if (meeting.retry_count >= 3) {
    throw new HTTPException2(400, { message: "Maximum retries reached" });
  }
  if (!meeting.audio_key) {
    throw new HTTPException2(400, { message: "Audio file no longer available" });
  }
  await sql`UPDATE meetings SET status = 'queued', failure_reason = NULL WHERE id = ${id}`;
  await enqueueProcessingJob({
    meeting_id: meeting.id,
    user_id: meeting.user_id,
    audio_key: meeting.audio_key,
    language: meeting.language,
    retry_count: meeting.retry_count + 1
  });
  return c.json({ ok: true });
});
var ShareBody = z3.object({ enabled: z3.boolean() });
app.post("/:id/share", zValidator("json", ShareBody), async (c) => {
  const id = c.req.param("id");
  const { enabled } = c.req.valid("json");
  const user = c.get("user");
  const sql = getSql();
  const share_token = enabled ? randomBytes(16).toString("hex") : null;
  await sql`UPDATE meetings SET share_token = ${share_token} WHERE id = ${id} AND user_id = ${user.id}`;
  const env2 = await Promise.resolve().then(() => (init_env(), env_exports)).then((m) => m.getEnv());
  return c.json({
    share_token,
    share_url: share_token ? `${env2.APP_URL}/share/${share_token}` : null
  });
});
var meetings_default = app;

// src/server/api/routes/action-items.ts
import { Hono as Hono2 } from "hono";
import { HTTPException as HTTPException3 } from "hono/http-exception";
import { zValidator as zValidator2 } from "@hono/zod-validator";
import { z as z4 } from "zod";
import { randomUUID as randomUUID2 } from "node:crypto";
var app2 = new Hono2();
var ListQuery = z4.object({
  completed: z4.union([z4.literal("true"), z4.literal("false")]).optional().transform((v) => v === void 0 ? void 0 : v === "true"),
  meeting_id: z4.string().uuid().optional(),
  assignee: z4.string().optional(),
  due_before: z4.string().optional()
});
app2.get("/", zValidator2("query", ListQuery), async (c) => {
  const q = c.req.valid("query");
  const user = c.get("user");
  const sql = getSql();
  const conditions = [sql`ai.user_id = ${user.id}`];
  if (q.completed !== void 0) conditions.push(sql`ai.completed = ${q.completed}`);
  if (q.meeting_id) conditions.push(sql`ai.meeting_id = ${q.meeting_id}`);
  if (q.assignee) conditions.push(sql`ai.assignee_name ILIKE ${`%${q.assignee}%`}`);
  if (q.due_before) conditions.push(sql`ai.due_date <= ${q.due_before}`);
  const where = conditions.reduce((acc, cur, i) => i === 0 ? cur : sql`${acc} AND ${cur}`);
  const items = await sql`
    SELECT
      ai.id, ai.meeting_id, m.title AS meeting_title,
      ai.description, ai.assignee_name, ai.assignee_id, ai.due_date,
      ai.completed, ai.timestamp_sec, ai.export_refs, ai.created_at
    FROM action_items ai
    JOIN meetings m ON m.id = ai.meeting_id
    WHERE ${where}
    ORDER BY ai.due_date NULLS LAST, ai.created_at DESC
  `;
  return c.json({ items });
});
app2.patch("/:id", zValidator2("json", ActionItemPatchRequest), async (c) => {
  const id = c.req.param("id");
  const patch = c.req.valid("json");
  const user = c.get("user");
  const sql = getSql();
  const sets = [];
  if (patch.description !== void 0) sets.push(sql`description = ${patch.description}`);
  if (patch.assignee_name !== void 0) sets.push(sql`assignee_name = ${patch.assignee_name}`);
  if (patch.due_date !== void 0) sets.push(sql`due_date = ${patch.due_date}`);
  if (patch.completed !== void 0) {
    sets.push(sql`completed = ${patch.completed}`);
    sets.push(sql`completed_at = ${patch.completed ? (/* @__PURE__ */ new Date()).toISOString() : null}`);
  }
  if (sets.length === 0) return c.json({ ok: true });
  const setClause = sets.reduce((acc, cur, i) => i === 0 ? cur : sql`${acc}, ${cur}`);
  await sql`UPDATE action_items SET ${setClause} WHERE id = ${id} AND user_id = ${user.id}`;
  return c.json({ ok: true });
});
app2.post("/:id/export", zValidator2("json", ActionItemExportRequest), async (c) => {
  const id = c.req.param("id");
  const { provider } = c.req.valid("json");
  const user = c.get("user");
  const sql = getSql();
  const items = await sql`
    SELECT id, description, export_refs FROM action_items
    WHERE id = ${id} AND user_id = ${user.id}
  `;
  const item = items[0];
  if (!item) throw new HTTPException3(404, { message: "Action item not found" });
  const integ = await sql`SELECT provider FROM integrations WHERE user_id = ${user.id} AND provider = ${provider}`;
  if (integ.length === 0) {
    throw new HTTPException3(400, {
      message: `${provider} is not connected. Connect it in Settings \u2192 Integrations.`
    });
  }
  const stubExportId = `${provider}-${randomUUID2().slice(0, 8)}`;
  const newRefs = { ...item.export_refs, [provider]: stubExportId };
  await sql`UPDATE action_items SET export_refs = ${JSON.stringify(newRefs)}::jsonb WHERE id = ${id}`;
  return c.json({ provider, external_id: stubExportId, external_url: null });
});
var action_items_default = app2;

// src/server/api/routes/chat.ts
import { Hono as Hono3 } from "hono";
import { HTTPException as HTTPException4 } from "hono/http-exception";
import { zValidator as zValidator3 } from "@hono/zod-validator";
import { stream } from "hono/streaming";

// src/server/services/llm.ts
init_env();
import OpenAI from "openai";

// src/server/lib/prompts.ts
var PROMPTS = {
  MEETING_ANALYSIS_SYSTEM: `You are EchoBrief's meeting analyst. You read meeting transcripts and produce:
  1. A structured summary with executive overview, key topics, decisions, and open questions
  2. A list of action items with assignees and deadlines where mentioned
  3. Chapter segmentation by topic

  Rules:
  - Be specific. "Suhaas will deploy the auth fix by Friday" \u2014 not "deploy something".
  - Never invent information. If an assignee or deadline is not stated, return null.
  - Action items must be concrete tasks, not topic mentions.
  - Decisions must be explicit ("we agreed to X"), not implied.`,
  meetingAnalysisUser: (transcript) => `Here is the meeting transcript:

  <transcript>
  ${transcript}
  </transcript>

  Analyze this meeting and return a structured response matching the schema.`,
  SCORE_SYSTEM: `You score meeting effectiveness on five dimensions, each 0\u201310:
  - Participation: balance of speaker contributions (10 = balanced, 0 = one person dominates)
  - Actionability: clarity of next steps (10 = clear owners + deadlines, 0 = no actions)
  - Focus: topic adherence (10 = stayed on agenda, 0 = constant tangents)
  - Clarity: communication directness (10 = explicit, 0 = vague/confused)
  - Efficiency: time well used (10 = concise, 0 = rambling)

  Total = weighted average. Provide a brief explanation (2\u20133 sentences).`,
  scoreUser: (transcript, speakerStats, actionItemCount) => `Speaker stats:
  ${speakerStats.map((s) => `- ${s.label}: ${s.talk_time_sec}s talk time, ${s.word_count} words`).join("\n")}

  Action items extracted: ${actionItemCount}

  Transcript:
  <transcript>
  ${transcript}
  </transcript>

  Score this meeting.`,
  perMeetingQaSystem: (transcript, meetingTitle) => `You are EchoBrief, answering questions about a specific meeting.

  Meeting: "${meetingTitle}"

  <transcript>
  ${transcript}
  </transcript>

  Rules:
  - Answer ONLY using information from the transcript above.
  - If the answer is not in the transcript, say so plainly. Do not invent facts.
  - Cite specific moments using timestamps when possible (e.g., "at 14:32, ...").
  - Be direct and specific. Avoid hedging language.`,
  crossMeetingQaSystem: (chunks) => `You are EchoBrief, answering questions across the user's meeting history.

  Use ONLY the context below to answer. Cite the source meeting and timestamp for each claim.
  If the context doesn't contain the answer, say so.

  <context>
  ${chunks.map(
    (c, i) => `[Source ${i + 1}] Meeting: "${c.meeting_title}" (at ${formatTimestamp(c.start_sec)})
${c.content}`
  ).join("\n\n")}
  </context>`,
  emailSystem: (type, tone) => {
    const typeMap = {
      meeting_recap: "a recap email to all attendees",
      stakeholder_update: "an executive-style update for stakeholders not in the meeting",
      sprint_summary: "an engineering-focused sprint summary",
      action_item_assignment: "individual task assignment messages"
    };
    return `You write ${typeMap[type]} based on a meeting summary. Tone: ${tone}.

  Rules:
  - Use real names and specific details from the meeting.
  - No generic AI fluff ("Hope this finds you well", "great meeting today").
  - Lead with what matters: decisions, action items, next steps.
  - Keep it under 200 words.
  - Output only the email body. No subject line, no signature placeholders.`;
  },
  emailUser: (summary, actionItems, participants) => `Meeting summary:
  ${summary.executive}

  Decisions:
  ${summary.decisions.map((d) => `- ${d}`).join("\n")}

  Action items:
  ${actionItems.map((a) => `- ${a.description}${a.assignee_name ? ` (${a.assignee_name})` : ""}${a.due_date ? ` \u2014 due ${a.due_date}` : ""}`).join("\n")}

  Open questions:
  ${summary.open_questions.map((q) => `- ${q}`).join("\n")}

  Participants: ${participants.join(", ") || "[not specified]"}

  Write the email.`
};
function formatTimestamp(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// src/server/services/llm.ts
var _client2 = null;
function getClient2() {
  if (_client2) return _client2;
  const env2 = getEnv();
  if (!env2.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not configured");
  }
  _client2 = new OpenAI({ apiKey: env2.OPENAI_API_KEY });
  return _client2;
}
async function streamGroundedAnswer(params) {
  const env2 = getEnv();
  if (!env2.OPENAI_API_KEY) {
    return stubStream("[OpenAI API key not configured \u2014 set OPENAI_API_KEY in .env to enable AI chat.]");
  }
  const client = getClient2();
  const stream4 = await client.chat.completions.create({
    model: env2.OPENAI_MODEL_PRIMARY,
    temperature: 0.3,
    stream: true,
    messages: [
      { role: "system", content: params.systemContext },
      ...params.history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: params.userMessage }
    ]
  });
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream4) {
          const delta = chunk.choices[0]?.delta.content;
          if (delta) controller.enqueue(encoder.encode(delta));
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    }
  });
}
async function generateEmail(params) {
  const env2 = getEnv();
  if (!env2.OPENAI_API_KEY) {
    return stubStream("[Email generation unavailable \u2014 OPENAI_API_KEY not configured.]");
  }
  const client = getClient2();
  const stream4 = await client.chat.completions.create({
    model: env2.OPENAI_MODEL_PRIMARY,
    temperature: 0.7,
    stream: true,
    messages: [
      { role: "system", content: PROMPTS.emailSystem(params.type, params.tone) },
      {
        role: "user",
        content: PROMPTS.emailUser(params.summary, params.actionItems, params.participants)
      }
    ]
  });
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream4) {
          const delta = chunk.choices[0]?.delta.content;
          if (delta) controller.enqueue(encoder.encode(delta));
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    }
  });
}
function stubStream(message) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(message));
      controller.close();
    }
  });
}

// src/server/api/routes/chat.ts
var app3 = new Hono3();
app3.post("/:id/chat", zValidator3("json", MeetingChatRequest), async (c) => {
  const id = c.req.param("id");
  const { message, history } = c.req.valid("json");
  const user = c.get("user");
  const sql = getSql();
  const rows = await sql`
    SELECT m.title, m.status, t.raw_text
    FROM meetings m
    LEFT JOIN transcripts t ON t.meeting_id = m.id
    WHERE m.id = ${id} AND m.user_id = ${user.id}
  `;
  const meeting = rows[0];
  if (!meeting) throw new HTTPException4(404, { message: "Meeting not found" });
  if (meeting.status !== "complete") {
    throw new HTTPException4(400, {
      message: "Meeting is still processing. Try again once it's complete."
    });
  }
  if (!meeting.raw_text) {
    throw new HTTPException4(400, { message: "No transcript available for this meeting" });
  }
  const systemContext = PROMPTS.perMeetingQaSystem(meeting.raw_text, meeting.title);
  const answerStream = await streamGroundedAnswer({
    systemContext,
    history,
    userMessage: message
  });
  c.header("content-type", "text/plain; charset=utf-8");
  c.header("cache-control", "no-cache");
  c.header("x-accel-buffering", "no");
  return stream(c, async (s) => {
    const reader = answerStream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await s.write(value);
      }
    } finally {
      reader.releaseLock();
    }
  });
});
var chat_default = app3;

// src/server/api/routes/search.ts
import { Hono as Hono4 } from "hono";
import { zValidator as zValidator4 } from "@hono/zod-validator";
import { stream as stream2 } from "hono/streaming";

// src/server/services/openai.ts
init_env();
import OpenAI2 from "openai";
var EMBEDDING_MODEL = "text-embedding-3-small";
var EMBEDDING_DIM = 1536;
var _client3 = null;
function getClient3() {
  if (_client3) return _client3;
  const env2 = getEnv();
  if (!env2.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not configured");
  }
  _client3 = new OpenAI2({ apiKey: env2.OPENAI_API_KEY });
  return _client3;
}
async function embedQuery(text) {
  const env2 = getEnv();
  if (!env2.OPENAI_API_KEY) return zeroVector();
  const client = getClient3();
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text
  });
  return response.data[0].embedding;
}
function zeroVector() {
  return new Array(EMBEDDING_DIM).fill(0);
}

// src/server/api/routes/search.ts
var app4 = new Hono4();
app4.post("/", zValidator4("json", SearchRequest), async (c) => {
  const { query, history, limit } = c.req.valid("json");
  const user = c.get("user");
  const sql = getSql();
  const embedding = await embedQuery(query);
  const vecLiteral = `[${embedding.join(",")}]`;
  const matches = await sql`
    SELECT * FROM match_transcript_chunks(
      ${vecLiteral}::vector,
      ${user.id}::uuid,
      ${limit}::int,
      0.5::real
    )
  `;
  if (matches.length === 0) {
    return c.json({
      answer: "I couldn't find relevant context for that question in your meetings.",
      citations: []
    });
  }
  const citations = matches.map((m) => ({
    meeting_id: m.meeting_id,
    meeting_title: m.meeting_title,
    start_sec: m.start_sec ?? 0,
    end_sec: m.end_sec ?? 0,
    excerpt: m.content.slice(0, 300),
    similarity: m.similarity
  }));
  const systemContext = PROMPTS.crossMeetingQaSystem(
    matches.map((m) => ({
      meeting_title: m.meeting_title,
      content: m.content,
      start_sec: m.start_sec ?? 0
    }))
  );
  const answerStream = await streamGroundedAnswer({
    systemContext,
    history,
    userMessage: query
  });
  c.header("content-type", "text/plain; charset=utf-8");
  c.header("cache-control", "no-cache");
  c.header("x-citations", encodeURIComponent(JSON.stringify(citations)));
  return stream2(c, async (s) => {
    const reader = answerStream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await s.write(value);
      }
    } finally {
      reader.releaseLock();
    }
  });
});
var search_default = app4;

// src/server/api/routes/integrations.ts
import { Hono as Hono5 } from "hono";
import { HTTPException as HTTPException5 } from "hono/http-exception";
import { zValidator as zValidator5 } from "@hono/zod-validator";
import { z as z5 } from "zod";
init_env();

// src/server/lib/encryption.ts
import { webcrypto } from "node:crypto";
var subtle = webcrypto.subtle;
var ALGO = "AES-GCM";
var IV_BYTES = 12;
async function importKey(rawBase64) {
  const raw = Uint8Array.from(Buffer.from(rawBase64, "base64"));
  if (raw.byteLength !== 32) {
    throw new Error("Encryption key must be 32 bytes (256-bit AES key)");
  }
  return subtle.importKey("raw", raw, ALGO, false, ["encrypt", "decrypt"]);
}
function b64(bytes) {
  return Buffer.from(bytes).toString("base64");
}
function unb64(s) {
  return Uint8Array.from(Buffer.from(s, "base64"));
}
async function encrypt(plaintext, keyB64) {
  const key = await importKey(keyB64);
  const iv = webcrypto.getRandomValues(new Uint8Array(IV_BYTES));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = new Uint8Array(await subtle.encrypt({ name: ALGO, iv }, key, encoded));
  const tagStart = ciphertext.length - 16;
  const ct = ciphertext.slice(0, tagStart);
  const tag = ciphertext.slice(tagStart);
  return `${b64(iv)}.${b64(ct)}.${b64(tag)}`;
}
async function decrypt(envelope, keyB64) {
  const [ivB64, ctB64, tagB64] = envelope.split(".");
  if (!ivB64 || !ctB64 || !tagB64) {
    throw new Error("Malformed encrypted envelope");
  }
  const key = await importKey(keyB64);
  const iv = unb64(ivB64);
  const ct = unb64(ctB64);
  const tag = unb64(tagB64);
  const combined = new Uint8Array(ct.length + tag.length);
  combined.set(ct, 0);
  combined.set(tag, ct.length);
  const plaintext = await subtle.decrypt({ name: ALGO, iv }, key, combined);
  return new TextDecoder().decode(plaintext);
}

// src/server/api/routes/integrations.ts
var app5 = new Hono5();
app5.get("/", async (c) => {
  const user = c.get("user");
  const sql = getSql();
  const items = await sql`
    SELECT provider, workspace_name, created_at
    FROM integrations WHERE user_id = ${user.id}
  `;
  return c.json({ items });
});
app5.post(
  "/:provider/connect",
  zValidator5("param", z5.object({ provider: IntegrationProvider })),
  async (c) => {
    const { provider } = c.req.valid("param");
    const user = c.get("user");
    const env2 = getEnv();
    if (!env2.INTEGRATION_TOKEN_ENCRYPTION_KEY) {
      throw new HTTPException5(500, {
        message: "INTEGRATION_TOKEN_ENCRYPTION_KEY not configured"
      });
    }
    const state = await encrypt(
      JSON.stringify({ user_id: user.id, ts: Date.now() }),
      env2.INTEGRATION_TOKEN_ENCRYPTION_KEY
    );
    const redirectUri = `${getApiPublicOrigin()}/api/v1/integrations/${provider}/callback`;
    const authorizeUrl = buildAuthorizeUrl(provider, redirectUri, state);
    return c.json({ authorize_url: authorizeUrl });
  }
);
app5.get(
  "/:provider/callback",
  zValidator5("param", z5.object({ provider: IntegrationProvider })),
  zValidator5("query", OAuthCallbackQuery),
  async (c) => {
    const { provider } = c.req.valid("param");
    const { code, state, error: oauthError } = c.req.valid("query");
    const env2 = getEnv();
    const sql = getSql();
    if (oauthError) {
      return c.redirect(`${env2.APP_URL}/app/settings?integration_error=${oauthError}`);
    }
    if (!env2.INTEGRATION_TOKEN_ENCRYPTION_KEY) {
      throw new HTTPException5(500, {
        message: "INTEGRATION_TOKEN_ENCRYPTION_KEY not configured"
      });
    }
    let parsedState;
    try {
      parsedState = JSON.parse(await decrypt(state, env2.INTEGRATION_TOKEN_ENCRYPTION_KEY));
    } catch {
      throw new HTTPException5(400, { message: "Invalid OAuth state" });
    }
    const tokenResult = {
      access_token: `pending_${provider}_token`,
      refresh_token: null,
      expires_at: null,
      workspace_name: null
    };
    void code;
    const encryptedAccess = await encrypt(
      tokenResult.access_token,
      env2.INTEGRATION_TOKEN_ENCRYPTION_KEY
    );
    const encryptedRefresh = tokenResult.refresh_token ? await encrypt(tokenResult.refresh_token, env2.INTEGRATION_TOKEN_ENCRYPTION_KEY) : null;
    await sql`
      INSERT INTO integrations (
        user_id, provider, access_token, refresh_token, expires_at, workspace_name
      ) VALUES (
        ${parsedState.user_id}, ${provider}, ${encryptedAccess}, ${encryptedRefresh},
        ${tokenResult.expires_at}, ${tokenResult.workspace_name}
      )
      ON CONFLICT (user_id, provider) DO UPDATE SET
        access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        expires_at = EXCLUDED.expires_at,
        workspace_name = EXCLUDED.workspace_name
    `;
    return c.redirect(`${env2.APP_URL}/app/settings?integration_connected=${provider}`);
  }
);
app5.delete(
  "/:provider",
  zValidator5("param", z5.object({ provider: IntegrationProvider })),
  async (c) => {
    const { provider } = c.req.valid("param");
    const user = c.get("user");
    const sql = getSql();
    await sql`DELETE FROM integrations WHERE user_id = ${user.id} AND provider = ${provider}`;
    return c.json({ ok: true });
  }
);
function buildAuthorizeUrl(provider, redirectUri, state) {
  const env2 = getEnv();
  const encodedRedirect = encodeURIComponent(redirectUri);
  const encodedState = encodeURIComponent(state);
  switch (provider) {
    case "notion":
      return `https://api.notion.com/v1/oauth/authorize?owner=user&client_id=${env2.NOTION_CLIENT_ID ?? ""}&redirect_uri=${encodedRedirect}&response_type=code&state=${encodedState}`;
    case "linear":
      return `https://linear.app/oauth/authorize?client_id=${env2.LINEAR_CLIENT_ID ?? ""}&redirect_uri=${encodedRedirect}&response_type=code&scope=read,write&state=${encodedState}`;
    case "google_calendar":
      return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${env2.GOOGLE_CLIENT_ID ?? ""}&redirect_uri=${encodedRedirect}&response_type=code&scope=${encodeURIComponent("https://www.googleapis.com/auth/calendar.events")}&state=${encodedState}&access_type=offline`;
    case "jira":
      return `https://auth.atlassian.com/authorize?audience=api.atlassian.com&client_id=&redirect_uri=${encodedRedirect}&response_type=code&prompt=consent&state=${encodedState}`;
    case "trello":
      return `https://trello.com/1/authorize?expiration=never&name=EchoBrief&scope=read,write&response_type=token&key=&return_url=${encodedRedirect}`;
  }
}
var integrations_default = app5;

// src/server/api/routes/account.ts
import { Hono as Hono6 } from "hono";
import { HTTPException as HTTPException6 } from "hono/http-exception";
import { zValidator as zValidator6 } from "@hono/zod-validator";
var app6 = new Hono6();
app6.get("/me", async (c) => {
  const user = c.get("user");
  const sql = getSql();
  const rows = await sql`SELECT id, email, name, avatar_url, created_at FROM users WHERE id = ${user.id}`;
  const me = rows[0];
  if (!me) throw new HTTPException6(404, { message: "User not found" });
  return c.json(me);
});
app6.patch("/me", zValidator6("json", UpdateProfileRequest), async (c) => {
  const patch = c.req.valid("json");
  const user = c.get("user");
  const sql = getSql();
  const sets = [];
  if (patch.name !== void 0) sets.push(sql`name = ${patch.name}`);
  if (patch.avatar_url !== void 0) sets.push(sql`avatar_url = ${patch.avatar_url}`);
  if (sets.length === 0) return c.json({ ok: true });
  const setClause = sets.reduce((acc, cur, i) => i === 0 ? cur : sql`${acc}, ${cur}`);
  await sql`UPDATE users SET ${setClause} WHERE id = ${user.id}`;
  return c.json({ ok: true });
});
app6.post("/export", async (c) => {
  const user = c.get("user");
  return c.json({
    queued: true,
    message: `Export queued for ${user.email}. You'll receive an email within 1 hour.`
  });
});
app6.delete("/me", async (c) => {
  const user = c.get("user");
  const sql = getSql();
  await sql`DELETE FROM users WHERE id = ${user.id}`;
  return c.json({ ok: true });
});
var account_default = app6;

// src/server/api/routes/generate.ts
import { Hono as Hono7 } from "hono";
import { HTTPException as HTTPException7 } from "hono/http-exception";
import { zValidator as zValidator7 } from "@hono/zod-validator";
import { stream as stream3 } from "hono/streaming";
var app7 = new Hono7();
app7.post("/email", zValidator7("json", EmailGenerationRequest), async (c) => {
  const { meeting_id, type, tone } = c.req.valid("json");
  const user = c.get("user");
  const sql = getSql();
  const rows = await sql`
    SELECT
      m.title, m.status,
      s.executive, s.key_topics, s.decisions, s.open_questions, s.chapters,
      t.speakers
    FROM meetings m
    LEFT JOIN summaries s ON s.meeting_id = m.id
    LEFT JOIN transcripts t ON t.meeting_id = m.id
    WHERE m.id = ${meeting_id} AND m.user_id = ${user.id}
  `;
  const meeting = rows[0];
  if (!meeting) throw new HTTPException7(404, { message: "Meeting not found" });
  if (meeting.status !== "complete") {
    throw new HTTPException7(400, { message: "Meeting is still processing" });
  }
  if (!meeting.executive) {
    throw new HTTPException7(400, { message: "No summary available" });
  }
  const actionItems = await sql`
    SELECT description, assignee_name, due_date, timestamp_sec
    FROM action_items WHERE meeting_id = ${meeting_id}
  `;
  const participants = (meeting.speakers ?? []).map((s) => s.label);
  const emailStream = await generateEmail({
    type,
    tone,
    summary: {
      executive: meeting.executive,
      key_topics: meeting.key_topics ?? [],
      decisions: meeting.decisions ?? [],
      open_questions: meeting.open_questions ?? [],
      chapters: meeting.chapters ?? []
    },
    actionItems: [...actionItems],
    participants
  });
  c.header("content-type", "text/plain; charset=utf-8");
  c.header("cache-control", "no-cache");
  return stream3(c, async (s) => {
    const reader = emailStream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await s.write(value);
      }
    } finally {
      reader.releaseLock();
    }
  });
});
var generate_default = app7;

// src/server/api/routes/share.ts
import { Hono as Hono8 } from "hono";
import { HTTPException as HTTPException8 } from "hono/http-exception";
var app8 = new Hono8();
app8.get("/:token", async (c) => {
  const token = c.req.param("token");
  if (!/^[a-f0-9]{16,64}$/i.test(token)) {
    throw new HTTPException8(400, { message: "Invalid share token" });
  }
  const sql = getSql();
  const rows = await sql`
    SELECT
      m.id, m.title, m.duration_sec, m.tags, m.created_at,
      s.executive, s.key_topics, s.decisions, s.open_questions
    FROM meetings m
    LEFT JOIN summaries s ON s.meeting_id = m.id
    WHERE m.share_token = ${token}
  `;
  const meeting = rows[0];
  if (!meeting) throw new HTTPException8(404, { message: "Shared meeting not found" });
  const actionItems = await sql`
    SELECT description, assignee_name, due_date
    FROM action_items WHERE meeting_id = ${meeting.id}
  `;
  return c.json({ ...meeting, action_items: actionItems });
});
var share_default = app8;

// src/server/api/index.ts
var api = new Hono9();
api.use("*", requestId);
api.use(
  "*",
  cors({
    origin: (origin) => {
      const env2 = getEnv();
      if (origin === env2.APP_URL) return origin;
      if (env2.NODE_ENV === "development") return origin ?? "*";
      return null;
    },
    credentials: true,
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["content-type", "authorization", "x-request-id"]
  })
);
api.onError(errorHandler);
api.get("/health", (c) => c.json({ ok: true, env: getEnv().NODE_ENV }));
api.route("/share", share_default);
var protectedApi = new Hono9();
protectedApi.use("*", requireAuth);
protectedApi.use("/meetings/*", rateLimit("general"));
protectedApi.use("/action-items/*", rateLimit("general"));
protectedApi.use("/account/*", rateLimit("general"));
protectedApi.use("/integrations/*", rateLimit("general"));
protectedApi.use("/search", rateLimit("ai"));
protectedApi.use("/generate/*", rateLimit("ai"));
protectedApi.use("/meetings/:id/chat", rateLimit("ai"));
protectedApi.route("/meetings", meetings_default);
protectedApi.route("/meetings", chat_default);
protectedApi.route("/action-items", action_items_default);
protectedApi.route("/search", search_default);
protectedApi.route("/integrations", integrations_default);
protectedApi.route("/account", account_default);
protectedApi.route("/generate", generate_default);
api.route("/", protectedApi);
var api_default = api;

// src/api.ts
init_env();
var app9 = new Hono10();
app9.route("/api/v1", api_default);
app9.get("/", (c) => c.json({ service: "echobrief-api", ok: true }));
var env = getEnv();
var server = serve(
  {
    fetch: app9.fetch,
    port: env.PORT,
    hostname: "0.0.0.0"
  },
  (info) => {
    console.log(`[api] listening on http://0.0.0.0:${info.port}`);
  }
);
async function shutdown(signal) {
  console.log(`[api] received ${signal}, shutting down...`);
  server.close(async () => {
    await closeSql();
    await closeRedis();
    await closeQueue();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 1e4).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
//# sourceMappingURL=api.js.map
