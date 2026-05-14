// src/server/workers/main.ts
import "dotenv/config";
import { Worker } from "bullmq";

// src/server/services/queue.ts
import { Queue } from "bullmq";
import Redis from "ioredis";

// src/server/env.ts
import { z } from "zod";
var EnvSchema = z.object({
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
var cached = null;
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

// src/server/services/queue.ts
var PROCESSING_QUEUE_NAME = "processing";
var _connection = null;
function getConnection() {
  if (_connection) return _connection;
  const env = getEnv();
  _connection = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false
  });
  return _connection;
}

// src/server/db/index.ts
import postgres from "postgres";
var _sql = null;
function getSql() {
  if (_sql) return _sql;
  const env = getEnv();
  _sql = postgres(env.DATABASE_URL, {
    ssl: env.DATABASE_SSL_DISABLED ? false : "require",
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

// src/server/services/r2.ts
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
var PRESIGN_TTL_SECONDS = 60 * 60;
var _client = null;
function getClient() {
  if (_client) return _client;
  const env = getEnv();
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    throw new Error("R2 credentials not configured (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)");
  }
  _client = new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY
    }
  });
  return _client;
}
async function createSignedReadUrl(audioKey, ttlSeconds = 600) {
  const env = getEnv();
  const cmd = new GetObjectCommand({
    Bucket: env.R2_BUCKET,
    Key: audioKey
  });
  return getSignedUrl(getClient(), cmd, { expiresIn: ttlSeconds });
}

// src/server/services/assemblyai.ts
import { AssemblyAI } from "assemblyai";
var MODEL = "best";
var _client2 = null;
function getClient2() {
  if (_client2) return _client2;
  const env = getEnv();
  if (!env.ASSEMBLYAI_API_KEY) {
    throw new Error("ASSEMBLYAI_API_KEY not configured");
  }
  _client2 = new AssemblyAI({ apiKey: env.ASSEMBLYAI_API_KEY });
  return _client2;
}
async function transcribeAudioUrl(audioUrl, language = "en") {
  const env = getEnv();
  if (!env.ASSEMBLYAI_API_KEY) {
    return stubTranscription(language);
  }
  const client = getClient2();
  const transcript = await client.transcripts.transcribe({
    audio: audioUrl,
    speech_model: MODEL,
    speaker_labels: true,
    punctuate: true,
    format_text: true,
    language_code: language
  });
  if (transcript.status === "error") {
    throw new Error(`AssemblyAI transcription failed: ${transcript.error ?? "unknown error"}`);
  }
  return normalize(transcript, language);
}
function normalize(t, language) {
  const words = (t.words ?? []).map((w) => ({
    word: w.text,
    start: w.start / 1e3,
    end: w.end / 1e3,
    confidence: w.confidence,
    speaker: w.speaker ?? null
  }));
  const paragraphs = (t.utterances ?? []).map((u) => ({
    start: u.start / 1e3,
    end: u.end / 1e3,
    speaker: u.speaker ?? null,
    text: u.text
  }));
  const speakers = computeSpeakerStats(words);
  const duration_sec = Math.floor(t.audio_duration ?? 0);
  const cost_usd = duration_sec / 60 * 35e-4;
  return {
    raw_text: t.text ?? "",
    language,
    words,
    paragraphs,
    speakers,
    duration_sec,
    cost_usd
  };
}
function computeSpeakerStats(words) {
  const stats = /* @__PURE__ */ new Map();
  for (const w of words) {
    if (!w.speaker) continue;
    const cur = stats.get(w.speaker) ?? { word_count: 0, talk_time_sec: 0 };
    cur.word_count += 1;
    cur.talk_time_sec += w.end - w.start;
    stats.set(w.speaker, cur);
  }
  return Array.from(stats.entries()).map(([id, s]) => ({
    id: `speaker_${id}`,
    label: `Speaker ${id}`,
    talk_time_sec: Math.round(s.talk_time_sec),
    word_count: s.word_count
  }));
}
function stubTranscription(language) {
  return {
    raw_text: "[Transcription pending \u2014 ASSEMBLYAI_API_KEY not configured]",
    language,
    words: [],
    paragraphs: [],
    speakers: [],
    duration_sec: 0,
    cost_usd: 0
  };
}

// src/server/services/llm.ts
import OpenAI from "openai";

// src/server/lib/prompts.ts
var ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "action_items"],
  properties: {
    summary: {
      type: "object",
      additionalProperties: false,
      required: ["executive", "key_topics", "decisions", "open_questions", "chapters"],
      properties: {
        executive: {
          type: "string",
          description: "3\u20135 sentence executive summary of the meeting."
        },
        key_topics: {
          type: "array",
          items: { type: "string" },
          description: "Up to 5 main topics discussed."
        },
        decisions: {
          type: "array",
          items: { type: "string" },
          description: "Concrete decisions made during the meeting."
        },
        open_questions: {
          type: "array",
          items: { type: "string" },
          description: "Unresolved questions or blockers."
        },
        chapters: {
          type: "array",
          description: "5\u201310 logical topic chapters with time ranges.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["title", "start_sec", "end_sec", "summary"],
            properties: {
              title: { type: "string" },
              start_sec: { type: "integer" },
              end_sec: { type: "integer" },
              summary: { type: "string" }
            }
          }
        }
      }
    },
    action_items: {
      type: "array",
      description: "Extracted concrete tasks with owner + deadline when stated.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description", "assignee_name", "due_date", "timestamp_sec"],
        properties: {
          description: { type: "string" },
          assignee_name: {
            type: ["string", "null"],
            description: "Name of person assigned, or null if not specified."
          },
          due_date: {
            type: ["string", "null"],
            description: "ISO date (YYYY-MM-DD) if mentioned, otherwise null."
          },
          timestamp_sec: {
            type: ["integer", "null"],
            description: "Approximate timestamp (seconds) in the meeting."
          }
        }
      }
    }
  }
};
var SCORE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "total",
    "participation",
    "actionability",
    "focus",
    "clarity",
    "efficiency",
    "explanation"
  ],
  properties: {
    total: { type: "number", description: "Overall score 0\u201310." },
    participation: { type: "number", description: "Speaker balance score 0\u201310." },
    actionability: { type: "number", description: "Action item clarity score 0\u201310." },
    focus: { type: "number", description: "Topic adherence score 0\u201310." },
    clarity: { type: "number", description: "Communication clarity score 0\u201310." },
    efficiency: { type: "number", description: "Time efficiency score 0\u201310." },
    explanation: { type: "string", description: "2\u20133 sentence rationale." }
  }
};
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
var _client3 = null;
function getClient3() {
  if (_client3) return _client3;
  const env = getEnv();
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not configured");
  }
  _client3 = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  return _client3;
}
async function analyzeMeeting(transcript) {
  const env = getEnv();
  if (!env.OPENAI_API_KEY) return stubAnalysis();
  const client = getClient3();
  const response = await client.chat.completions.create({
    model: env.OPENAI_MODEL_PRIMARY,
    temperature: 0.3,
    messages: [
      { role: "system", content: PROMPTS.MEETING_ANALYSIS_SYSTEM },
      { role: "user", content: PROMPTS.meetingAnalysisUser(transcript) }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "meeting_analysis",
        strict: true,
        schema: ANALYSIS_SCHEMA
      }
    }
  });
  const raw = response.choices[0]?.message.content;
  if (!raw) throw new Error("OpenAI returned no content");
  const parsed = JSON.parse(raw);
  const usage = response.usage;
  const cost_usd = usage ? usage.prompt_tokens / 1e6 * 5 + usage.completion_tokens / 1e6 * 15 : 0;
  return {
    summary: parsed.summary,
    action_items: parsed.action_items,
    cost_usd
  };
}
async function scoreMeeting(transcript, speakerStats, actionItemCount) {
  const env = getEnv();
  if (!env.OPENAI_API_KEY) return { score: stubScore(), cost_usd: 0 };
  const client = getClient3();
  const response = await client.chat.completions.create({
    model: env.OPENAI_MODEL_LIGHT,
    temperature: 0.3,
    messages: [
      { role: "system", content: PROMPTS.SCORE_SYSTEM },
      { role: "user", content: PROMPTS.scoreUser(transcript, speakerStats, actionItemCount) }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "meeting_score",
        strict: true,
        schema: SCORE_SCHEMA
      }
    }
  });
  const raw = response.choices[0]?.message.content;
  if (!raw) throw new Error("OpenAI returned no content for score");
  const score = JSON.parse(raw);
  const usage = response.usage;
  const cost_usd = usage ? usage.prompt_tokens / 1e6 * 0.5 + usage.completion_tokens / 1e6 * 2 : 0;
  return { score, cost_usd };
}
function stubAnalysis() {
  return {
    summary: {
      executive: "[Summary pending \u2014 OPENAI_API_KEY not configured]",
      key_topics: [],
      decisions: [],
      open_questions: [],
      chapters: []
    },
    action_items: [],
    cost_usd: 0
  };
}
function stubScore() {
  return {
    total: 0,
    participation: 0,
    actionability: 0,
    focus: 0,
    clarity: 0,
    efficiency: 0,
    explanation: "[Score pending \u2014 OPENAI_API_KEY not configured]"
  };
}

// src/server/services/openai.ts
import OpenAI2 from "openai";
var EMBEDDING_MODEL = "text-embedding-3-small";
var EMBEDDING_DIM = 1536;
var BATCH_SIZE = 100;
var _client4 = null;
function getClient4() {
  if (_client4) return _client4;
  const env = getEnv();
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not configured");
  }
  _client4 = new OpenAI2({ apiKey: env.OPENAI_API_KEY });
  return _client4;
}
async function embedChunks(chunks) {
  const env = getEnv();
  if (!env.OPENAI_API_KEY || chunks.length === 0) {
    return { embeddings: chunks.map(() => zeroVector()), cost_usd: 0 };
  }
  const client = getClient4();
  const embeddings = [];
  let totalTokens = 0;
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const response = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch
    });
    embeddings.push(...response.data.map((d) => d.embedding));
    totalTokens += response.usage.total_tokens;
  }
  const cost_usd = totalTokens / 1e6 * 0.02;
  return { embeddings, cost_usd };
}
function zeroVector() {
  return new Array(EMBEDDING_DIM).fill(0);
}

// src/server/services/resend.ts
import { Resend } from "resend";
var FROM_ADDRESS = "EchoBrief <hello@echobrief.ai>";
var _client5 = null;
function getClient5() {
  if (_client5) return _client5;
  const env = getEnv();
  if (!env.RESEND_API_KEY) return null;
  _client5 = new Resend(env.RESEND_API_KEY);
  return _client5;
}
async function sendProcessingCompleteEmail(to, meetingTitle, meetingUrl) {
  const client = getClient5();
  if (!client) {
    console.log(`[resend stub] processing complete email to ${to}`);
    return;
  }
  await client.emails.send({
    from: FROM_ADDRESS,
    to,
    subject: `Your meeting is ready: ${meetingTitle}`,
    html: `
      <p>Your meeting <strong>${escapeHtml(meetingTitle)}</strong> has finished processing.</p>
      <p><a href="${meetingUrl}">View summary and action items \u2192</a></p>
    `
  });
}
async function sendProcessingFailedEmail(to, meetingTitle, reason) {
  const client = getClient5();
  if (!client) {
    console.log(`[resend stub] processing failed email to ${to}`);
    return;
  }
  await client.emails.send({
    from: FROM_ADDRESS,
    to,
    subject: `Processing failed: ${meetingTitle}`,
    html: `
      <p>We weren't able to finish processing <strong>${escapeHtml(meetingTitle)}</strong>.</p>
      <p>Reason: ${escapeHtml(reason)}</p>
      <p>You can retry from the meeting page.</p>
    `
  });
}
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// src/server/lib/chunking.ts
var CHUNK_WORDS = 200;
var OVERLAP_WORDS = 50;
function chunkTranscript(words) {
  if (words.length === 0) return [];
  const chunks = [];
  let index = 0;
  let i = 0;
  while (i < words.length) {
    const end = Math.min(i + CHUNK_WORDS, words.length);
    const slice = words.slice(i, end);
    chunks.push({
      index: index++,
      content: slice.map((w) => w.word).join(" "),
      start_sec: Math.floor(slice[0].start),
      end_sec: Math.ceil(slice[slice.length - 1].end)
    });
    if (end === words.length) break;
    i += CHUNK_WORDS - OVERLAP_WORDS;
  }
  return chunks;
}

// src/server/workers/processing.ts
async function processMeeting(job) {
  const sql = getSql();
  await sql`UPDATE meetings SET status = 'transcribing' WHERE id = ${job.meeting_id}`;
  const audioUrl = await createSignedReadUrl(job.audio_key, 1800);
  const transcribeStart = Date.now();
  const result = await transcribeAudioUrl(audioUrl, job.language ?? "en");
  await sql`
    INSERT INTO transcripts (meeting_id, raw_text, content, speakers, language, provider)
    VALUES (
      ${job.meeting_id},
      ${result.raw_text},
      ${JSON.stringify({ words: result.words, paragraphs: result.paragraphs })}::jsonb,
      ${JSON.stringify(result.speakers)}::jsonb,
      ${result.language},
      'assemblyai'
    )
    ON CONFLICT (meeting_id) DO UPDATE SET
      raw_text = EXCLUDED.raw_text,
      content = EXCLUDED.content,
      speakers = EXCLUDED.speakers,
      language = EXCLUDED.language,
      provider = EXCLUDED.provider
  `;
  await sql`UPDATE meetings SET duration_sec = ${result.duration_sec} WHERE id = ${job.meeting_id}`;
  await logStep(job, {
    step: "transcribe",
    provider: "assemblyai",
    model: "best",
    duration_ms: Date.now() - transcribeStart,
    cost_usd: result.cost_usd,
    status: "success"
  });
  await sql`UPDATE meetings SET status = 'analyzing' WHERE id = ${job.meeting_id}`;
  const analyzeStart = Date.now();
  const analysis = await analyzeMeeting(result.raw_text);
  await sql`
    INSERT INTO summaries (
      meeting_id, executive, key_topics, decisions, open_questions, chapters, model
    ) VALUES (
      ${job.meeting_id},
      ${analysis.summary.executive},
      ${sql.array(analysis.summary.key_topics)},
      ${sql.array(analysis.summary.decisions)},
      ${sql.array(analysis.summary.open_questions)},
      ${JSON.stringify(analysis.summary.chapters)}::jsonb,
      ${getEnv().OPENAI_MODEL_PRIMARY}
    )
    ON CONFLICT (meeting_id) DO UPDATE SET
      executive = EXCLUDED.executive,
      key_topics = EXCLUDED.key_topics,
      decisions = EXCLUDED.decisions,
      open_questions = EXCLUDED.open_questions,
      chapters = EXCLUDED.chapters,
      model = EXCLUDED.model,
      generated_at = now()
  `;
  await sql`DELETE FROM action_items WHERE meeting_id = ${job.meeting_id}`;
  if (analysis.action_items.length > 0) {
    await sql`
      INSERT INTO action_items ${sql(
      analysis.action_items.map((item) => ({
        meeting_id: job.meeting_id,
        user_id: job.user_id,
        description: item.description,
        assignee_name: item.assignee_name,
        due_date: item.due_date,
        timestamp_sec: item.timestamp_sec
      }))
    )}
    `;
  }
  await logStep(job, {
    step: "analyze",
    provider: "openai",
    model: getEnv().OPENAI_MODEL_PRIMARY,
    duration_ms: Date.now() - analyzeStart,
    cost_usd: analysis.cost_usd,
    status: "success"
  });
  await sql`UPDATE meetings SET status = 'indexing' WHERE id = ${job.meeting_id}`;
  const chunks = chunkTranscript(result.words);
  if (chunks.length > 0) {
    const embedStart = Date.now();
    const { embeddings, cost_usd } = await embedChunks(chunks.map((c) => c.content));
    await sql`DELETE FROM transcript_chunks WHERE meeting_id = ${job.meeting_id}`;
    await sql`
      INSERT INTO transcript_chunks ${sql(
      chunks.map((chunk, i) => ({
        meeting_id: job.meeting_id,
        user_id: job.user_id,
        chunk_index: chunk.index,
        content: chunk.content,
        start_sec: chunk.start_sec,
        end_sec: chunk.end_sec,
        embedding: `[${embeddings[i].join(",")}]`
      }))
    )}
    `;
    await logStep(job, {
      step: "embed",
      provider: "openai",
      model: "text-embedding-3-small",
      duration_ms: Date.now() - embedStart,
      cost_usd,
      status: "success"
    });
  }
  try {
    const scoreStart = Date.now();
    const { score, cost_usd } = await scoreMeeting(
      result.raw_text,
      result.speakers,
      analysis.action_items.length
    );
    await sql`UPDATE meetings SET meeting_score = ${JSON.stringify(score)}::jsonb WHERE id = ${job.meeting_id}`;
    await logStep(job, {
      step: "score",
      provider: "openai",
      model: getEnv().OPENAI_MODEL_LIGHT,
      duration_ms: Date.now() - scoreStart,
      cost_usd,
      status: "success"
    });
  } catch (err) {
    console.warn("[score-skipped]", err);
  }
  await sql`
    UPDATE meetings
    SET status = 'complete', processed_at = now()
    WHERE id = ${job.meeting_id}
  `;
  await notifyComplete(job).catch((e) => console.error("[notify-failed]", e));
}
async function markFailed(job, err) {
  const sql = getSql();
  const reason = err instanceof Error ? err.message : String(err);
  await sql`
    UPDATE meetings
    SET status = 'failed',
        failure_reason = ${reason.slice(0, 500)},
        retry_count = retry_count + 1
    WHERE id = ${job.meeting_id}
  `;
  await logStep(job, { step: "pipeline", status: "failure", error: reason.slice(0, 500) });
  await notifyFailure(job, reason).catch((e) => console.error("[notify-failed]", e));
}
async function notifyComplete(job) {
  const sql = getSql();
  const env = getEnv();
  const rows = await sql`
    SELECT m.title, u.email
    FROM meetings m
    JOIN users u ON u.id = m.user_id
    WHERE m.id = ${job.meeting_id}
  `;
  const row = rows[0];
  if (!row?.email) return;
  await sendProcessingCompleteEmail(
    row.email,
    row.title,
    `${env.APP_URL}/app/meetings/${job.meeting_id}`
  );
}
async function notifyFailure(job, reason) {
  const sql = getSql();
  const rows = await sql`
    SELECT m.title, u.email
    FROM meetings m
    JOIN users u ON u.id = m.user_id
    WHERE m.id = ${job.meeting_id}
  `;
  const row = rows[0];
  if (!row?.email) return;
  await sendProcessingFailedEmail(row.email, row.title, reason);
}
async function logStep(job, entry) {
  const sql = getSql();
  await sql`
    INSERT INTO pipeline_logs (
      meeting_id, user_id, step, provider, model, duration_ms, cost_usd, status, error
    ) VALUES (
      ${job.meeting_id}, ${job.user_id}, ${entry.step},
      ${entry.provider ?? null}, ${entry.model ?? null},
      ${entry.duration_ms ?? null}, ${entry.cost_usd ?? null},
      ${entry.status}, ${entry.error ?? null}
    )
  `;
}

// src/server/services/redis.ts
import Redis2 from "ioredis";
var _redis = null;
async function closeRedis() {
  if (_redis) {
    await _redis.quit();
    _redis = null;
  }
}

// src/server/workers/main.ts
var worker = new Worker(
  PROCESSING_QUEUE_NAME,
  async (job) => {
    console.log(`[worker] processing ${job.id}`);
    await processMeeting(job.data);
  },
  {
    connection: getConnection(),
    concurrency: 1,
    lockDuration: 15 * 60 * 1e3
    // 15 minutes; AI pipeline can be slow
  }
);
worker.on("failed", async (job, err) => {
  if (!job) return;
  console.error(`[worker] job ${job.id} failed (attempt ${job.attemptsMade}/${job.opts.attempts}):`, err.message);
  if (job.attemptsMade >= (job.opts.attempts ?? 3)) {
    await markFailed(job.data, err);
  }
});
worker.on("completed", (job) => {
  console.log(`[worker] job ${job.id} complete`);
});
worker.on("error", (err) => {
  console.error("[worker-error]", err);
});
async function shutdown(signal) {
  console.log(`[worker] received ${signal}, shutting down...`);
  await worker.close();
  await closeSql();
  await closeRedis();
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
console.log(`[worker] listening on queue "${PROCESSING_QUEUE_NAME}"`);
//# sourceMappingURL=main.js.map
