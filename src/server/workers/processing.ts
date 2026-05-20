/* reload tick — harden logStep */
/**
 * Processing pipeline (BullMQ job handler).
 *
 * Steps per meeting:
 *   1. Transcribe (AssemblyAI)
 *   2. Analyze (OpenAI GPT-5) — summary + action items in one structured call
 *   3. Embed (OpenAI text-embedding-3-small) — pgvector index
 *   4. Score (OpenAI GPT-5 mini)
 *
 * Each step updates meetings.status so the UI can poll progress.
 * BullMQ handles retries + DLQ via job options set in services/queue.ts.
 */

import type { ProcessingJob } from "../env";
import { getSql } from "../db";
import { createSignedReadUrl } from "../services/r2";
import { transcribeAudioUrl, type TranscriptionWord } from "../services/assemblyai";
import { analyzeMeeting, scoreMeeting } from "../services/llm";
import { embedChunks } from "../services/openai";
import {
  sendProcessingCompleteEmail,
  sendProcessingFailedEmail,
} from "../services/resend";
import { chunkTranscript, chunkRawText } from "../lib/chunking";
import { getEnv } from "../env";
import { logTranscription, logAIQuery } from "../services/usage-tracker";

interface SpeakerStat { label: string; talk_time_sec: number; word_count: number }

export async function processMeeting(job: ProcessingJob): Promise<void> {
  const sql = getSql();

  // Resolve the meeting's workspace once — child inserts (action_items,
  // transcript_chunks) need workspace_id and the BullMQ payload doesn't carry it.
  const meetingRows = await sql<Array<{ workspace_id: string }>>`
    SELECT workspace_id FROM meetings WHERE id = ${job.meeting_id} LIMIT 1
  `;
  if (meetingRows.length === 0) {
    throw new Error(`Meeting ${job.meeting_id} not found`);
  }
  const workspaceId = meetingRows[0].workspace_id;

  // ---- 1. Transcribe (or skip if user uploaded text directly) -----------
  // For transcript-only uploads, a `transcripts` row already exists and
  // `audio_key` is empty. Skip the AssemblyAI step entirely.
  const existing = await sql<Array<{ raw_text: string }>>`
    SELECT raw_text FROM transcripts WHERE meeting_id = ${job.meeting_id} LIMIT 1
  `;
  const transcriptProvided = existing.length > 0 && !job.audio_key;

  let raw_text: string;
  let words: TranscriptionWord[] = [];
  let speakers: SpeakerStat[] = [];

  if (transcriptProvided) {
    raw_text = existing[0].raw_text;
    await logStep(job, {
      step: "transcribe",
      provider: "user",
      model: "pasted",
      duration_ms: 0,
      cost_usd: 0,
      status: "success",
    });
  } else {
    await sql`UPDATE meetings SET status = 'transcribing' WHERE id = ${job.meeting_id}`;

    const audioUrl = await createSignedReadUrl(job.audio_key, 1800);
    const transcribeStart = Date.now();
    const result = await transcribeAudioUrl(audioUrl, job.language ?? "en");

    // postgres.js double-encodes objects when bound as text+::jsonb, storing
    // the value as a JSONB string scalar instead of an object. Reads are
    // normalized in src/server/api/routes/meetings.ts (buildTranscriptResponse
    // parses the string back into segments) so this stays compatible with the
    // many already-inserted rows in production.
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
      model: "universal",
      duration_ms: Date.now() - transcribeStart,
      cost_usd: result.cost_usd,
      status: "success",
    });

    // Log transcription usage for quota tracking
    await logTranscription(job.user_id, workspaceId, result.duration_sec, result.cost_usd);

    raw_text = result.raw_text;
    words = result.words;
    speakers = result.speakers;
  }

  // ---- 2. Analyze -------------------------------------------------------
  await sql`UPDATE meetings SET status = 'analyzing' WHERE id = ${job.meeting_id}`;

  const analyzeStart = Date.now();
  const analysis = await analyzeMeeting(raw_text);

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
          workspace_id: workspaceId,
          description: item.description,
          assignee_name: item.assignee_name,
          due_date: item.due_date,
          timestamp_sec: item.timestamp_sec,
        })),
      )}
    `;
  }

  await logStep(job, {
    step: "analyze",
    provider: "openai",
    model: getEnv().OPENAI_MODEL_PRIMARY,
    duration_ms: Date.now() - analyzeStart,
    cost_usd: analysis.cost_usd,
    status: "success",
  });

  // Log AI query usage (summary + action items generation)
  await logAIQuery(job.user_id, workspaceId, analysis.cost_usd);

  // ---- 3. Embed for vector search ---------------------------------------
  await sql`UPDATE meetings SET status = 'indexing' WHERE id = ${job.meeting_id}`;

  const chunks = words.length > 0 ? chunkTranscript(words) : chunkRawText(raw_text);
  if (chunks.length > 0) {
    const embedStart = Date.now();
    const { embeddings, cost_usd } = await embedChunks(chunks.map((c) => c.content));

    await sql`DELETE FROM transcript_chunks WHERE meeting_id = ${job.meeting_id}`;

    // pgvector accepts the string '[1.0,2.0,...]' for VECTOR columns.
    await sql`
      INSERT INTO transcript_chunks ${sql(
        chunks.map((chunk, i) => ({
          meeting_id: job.meeting_id,
          user_id: job.user_id,
          workspace_id: workspaceId,
          chunk_index: chunk.index,
          content: chunk.content,
          start_sec: chunk.start_sec,
          end_sec: chunk.end_sec,
          embedding: `[${embeddings[i].join(",")}]`,
        })),
      )}
    `;

    await logStep(job, {
      step: "embed",
      provider: "openai",
      model: "text-embedding-3-small",
      duration_ms: Date.now() - embedStart,
      cost_usd,
      status: "success",
    });
  }

  // ---- 4. Score (best-effort) -------------------------------------------
  try {
    const scoreStart = Date.now();
    const { score, cost_usd } = await scoreMeeting(
      raw_text,
      speakers,
      analysis.action_items.length,
    );

    await sql`UPDATE meetings SET meeting_score = ${JSON.stringify(score)}::jsonb WHERE id = ${job.meeting_id}`;

    await logStep(job, {
      step: "score",
      provider: "openai",
      model: getEnv().OPENAI_MODEL_LIGHT,
      duration_ms: Date.now() - scoreStart,
      cost_usd,
      status: "success",
    });
  } catch (err) {
    console.warn("[score-skipped]", err);
  }

  // ---- 5. Complete + notify ---------------------------------------------
  await sql`
    UPDATE meetings
    SET status = 'complete', processed_at = now()
    WHERE id = ${job.meeting_id}
  `;

  await notifyComplete(job).catch((e) => console.error("[notify-failed]", e));
}

export async function markFailed(job: ProcessingJob, err: unknown): Promise<void> {
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

async function notifyComplete(job: ProcessingJob): Promise<void> {
  const sql = getSql();
  const env = getEnv();
  const rows = await sql<Array<{ title: string; email: string | null }>>`
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
    `${env.APP_URL}/app/meetings/${job.meeting_id}`,
  );
}

async function notifyFailure(job: ProcessingJob, reason: string): Promise<void> {
  const sql = getSql();
  const rows = await sql<Array<{ title: string; email: string | null }>>`
    SELECT m.title, u.email
    FROM meetings m
    JOIN users u ON u.id = m.user_id
    WHERE m.id = ${job.meeting_id}
  `;
  const row = rows[0];
  if (!row?.email) return;

  await sendProcessingFailedEmail(row.email, row.title, reason);
}

async function logStep(
  job: ProcessingJob,
  entry: {
    step: string;
    provider?: string;
    model?: string;
    duration_ms?: number;
    cost_usd?: number;
    status: "success" | "failure";
    error?: string;
  },
): Promise<void> {
  const sql = getSql();
  try {
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
  } catch (err) {
    // The meeting (or user) may have been deleted between job enqueue and the
    // log write — FK violation 23503 lands here. Logging is best-effort; never
    // let it crash the worker.
    console.warn("[log-step-failed]", job.meeting_id, entry.step, err instanceof Error ? err.message : err);
  }
}
