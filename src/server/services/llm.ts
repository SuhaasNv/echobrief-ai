/**
 * OpenAI GPT-5 service (LLM).
 *
 * All LLM tasks route through here:
 *   - Meeting summary + action item extraction (batch, structured JSON output)
 *   - Per-meeting Q&A (streaming)
 *   - Cross-meeting RAG Q&A (streaming)
 *   - Meeting score (cheap model)
 *   - Follow-up email generation (streaming)
 *
 * Structured outputs use response_format: json_schema (Strict Mode) — never
 * parse freeform JSON from text. This gives us schema-validated, deterministic
 * shape that matches our TypeScript types exactly.
 */

import OpenAI from "openai";
import { getEnv } from "../env";
import {
  ANALYSIS_SCHEMA,
  SCORE_SCHEMA,
  FLASHCARDS_SCHEMA,
  PROMPTS,
  type AnalysisStructured,
  type ScoreStructured,
  type FlashcardsStructured,
} from "../lib/prompts";

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (_client) return _client;
  const env = getEnv();
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not configured");
  }
  _client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  return _client;
}

// ----------------------------------------------------------------------------
// Cost accounting
// ----------------------------------------------------------------------------

/**
 * USD per 1M tokens, keyed on the exact model string we send to OpenAI
 * (env.OPENAI_MODEL_PRIMARY / OPENAI_MODEL_LIGHT).
 *
 * Every call site used to hardcode $5 in / $15 out — GPT-4o's rates — while the
 * service has been running GPT-5. That flowed straight into pipeline_logs.cost_usd,
 * usage_logs.total_cost_usd and the analytics endpoint, wrong in both directions
 * (4x over on the primary model, under on the light one).
 */
const MODEL_PRICING_USD_PER_1M: Record<string, { input: number; output: number }> = {
  "gpt-5": { input: 1.25, output: 10 },
  "gpt-5-mini": { input: 0.25, output: 2 },
};

/**
 * Used when OPENAI_MODEL_* points at a model we have no verified price for.
 * These are gpt-5's rates, not a guess at the unknown model's: an operator who
 * switches models gets a cost figure anchored to a real price they can reason
 * about, rather than an invented one. Add the model above when its price is known.
 */
const FALLBACK_PRICING_USD_PER_1M = { input: 1.25, output: 10 };

/**
 * Note on completion_tokens: for reasoning models it includes reasoning tokens,
 * which are billed at the output rate even though they never reach us. That is
 * why every call below caps max_completion_tokens.
 */
function computeCostUsd(model: string, usage: OpenAI.CompletionUsage | undefined): number {
  if (!usage) return 0;
  const price = MODEL_PRICING_USD_PER_1M[model] ?? FALLBACK_PRICING_USD_PER_1M;
  return (
    (usage.prompt_tokens / 1_000_000) * price.input +
    (usage.completion_tokens / 1_000_000) * price.output
  );
}

// ----------------------------------------------------------------------------
// Public types (re-exported from prompts/schemas)
// ----------------------------------------------------------------------------

export type SummaryOutput = AnalysisStructured["summary"];
export type ActionItemOutput = AnalysisStructured["action_items"][number];
export type MeetingScore = ScoreStructured;

export interface AnalysisResult {
  summary: SummaryOutput;
  action_items: ActionItemOutput[];
  cost_usd: number;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

// ----------------------------------------------------------------------------
// Summary + action items (single call, structured output)
// ----------------------------------------------------------------------------

export async function analyzeMeeting(transcript: string): Promise<AnalysisResult> {
  const env = getEnv();
  if (!env.OPENAI_API_KEY) return stubAnalysis();

  const client = getClient();
  const response = await client.chat.completions.create({
    model: env.OPENAI_MODEL_PRIMARY,
    // Extraction against a strict schema, not a reasoning problem: "low" is the
    // lowest the installed SDK's ReasoningEffort union accepts (no "minimal"),
    // and without it GPT-5 silently defaults to medium. The cap bounds an
    // otherwise unlimited reasoning run that bills at the output rate; a summary
    // with chapters and action items lands well inside it.
    reasoning_effort: "low",
    max_completion_tokens: 8000,
    messages: [
      { role: "system", content: PROMPTS.MEETING_ANALYSIS_SYSTEM },
      { role: "user", content: PROMPTS.meetingAnalysisUser(transcript) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "meeting_analysis",
        strict: true,
        schema: ANALYSIS_SCHEMA,
      },
    },
  });

  const raw = response.choices[0]?.message.content;
  if (!raw) throw new Error("OpenAI returned no content");
  const parsed = JSON.parse(raw) as AnalysisStructured;

  const cost_usd = computeCostUsd(env.OPENAI_MODEL_PRIMARY, response.usage);

  return {
    summary: parsed.summary,
    action_items: parsed.action_items,
    cost_usd,
  };
}

// ----------------------------------------------------------------------------
// Flashcards (student-only, single call, structured output)
// ----------------------------------------------------------------------------

export interface FlashcardOutput {
  question: string;
  answer: string;
  difficulty: "easy" | "medium" | "hard";
}

export interface FlashcardsResult {
  cards: FlashcardOutput[];
  cost_usd: number;
}

export async function generateFlashcards(
  transcript: string,
  title: string,
): Promise<FlashcardsResult> {
  const env = getEnv();
  if (!env.OPENAI_API_KEY) return stubFlashcards();

  const client = getClient();
  const response = await client.chat.completions.create({
    model: env.OPENAI_MODEL_PRIMARY,
    // See analyzeMeeting. 8–15 self-contained cards fit inside this cap with
    // room left for low-effort reasoning tokens.
    reasoning_effort: "low",
    max_completion_tokens: 8000,
    messages: [
      { role: "system", content: PROMPTS.FLASHCARDS_SYSTEM },
      { role: "user", content: PROMPTS.flashcardsUser(transcript, title) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "flashcards",
        strict: true,
        schema: FLASHCARDS_SCHEMA,
      },
    },
  });

  const raw = response.choices[0]?.message.content;
  if (!raw) throw new Error("OpenAI returned no content");
  const parsed = JSON.parse(raw) as FlashcardsStructured;

  const cost_usd = computeCostUsd(env.OPENAI_MODEL_PRIMARY, response.usage);

  return { cards: parsed.cards, cost_usd };
}

function stubFlashcards(): FlashcardsResult {
  return {
    cards: [
      {
        question: "What is the main argument of this lecture? (stub)",
        answer: "OPENAI_API_KEY is not configured. Set it in .env to generate real flashcards.",
        difficulty: "easy",
      },
    ],
    cost_usd: 0,
  };
}

// ----------------------------------------------------------------------------
// Meeting score (light model)
// ----------------------------------------------------------------------------

export async function scoreMeeting(
  transcript: string,
  speakerStats: Array<{ label: string; talk_time_sec: number; word_count: number }>,
  actionItemCount: number,
): Promise<{ score: MeetingScore; cost_usd: number }> {
  const env = getEnv();
  if (!env.OPENAI_API_KEY) return { score: stubScore(), cost_usd: 0 };

  const client = getClient();
  const response = await client.chat.completions.create({
    model: env.OPENAI_MODEL_LIGHT,
    // See analyzeMeeting. Output here is six numbers and a short explanation.
    reasoning_effort: "low",
    max_completion_tokens: 4000,
    messages: [
      { role: "system", content: PROMPTS.SCORE_SYSTEM },
      { role: "user", content: PROMPTS.scoreUser(transcript, speakerStats, actionItemCount) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "meeting_score",
        strict: true,
        schema: SCORE_SCHEMA,
      },
    },
  });

  const raw = response.choices[0]?.message.content;
  if (!raw) throw new Error("OpenAI returned no content for score");
  const score = JSON.parse(raw) as MeetingScore;

  const cost_usd = computeCostUsd(env.OPENAI_MODEL_LIGHT, response.usage);

  return { score, cost_usd };
}

// ----------------------------------------------------------------------------
// Streaming Q&A
// ----------------------------------------------------------------------------

export async function streamGroundedAnswer(params: {
  systemContext: string;
  history: ChatTurn[];
  userMessage: string;
}): Promise<ReadableStream<Uint8Array>> {
  const env = getEnv();
  if (!env.OPENAI_API_KEY) {
    return stubStream(
      "[OpenAI API key not configured — set OPENAI_API_KEY in .env to enable AI chat.]",
    );
  }

  const client = getClient();
  const stream = await client.chat.completions.create({
    model: env.OPENAI_MODEL_PRIMARY,
    stream: true,
    // Same reasoning-token bill applies to streamed calls, and at medium effort
    // GPT-5 also holds the first token back while it thinks. Grounded Q&A over
    // supplied context does not need more than "low"; 4000 tokens is far more
    // than any answer we render.
    reasoning_effort: "low",
    max_completion_tokens: 4000,
    messages: [
      { role: "system", content: params.systemContext },
      ...params.history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: params.userMessage },
    ],
  });

  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta.content;
          if (delta) controller.enqueue(encoder.encode(delta));
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

// ----------------------------------------------------------------------------
// Email generation (streaming, freeform — no structured schema needed)
// ----------------------------------------------------------------------------

export async function generateEmail(params: {
  type: "meeting_recap" | "stakeholder_update" | "sprint_summary" | "action_item_assignment";
  tone: "professional" | "casual";
  summary: SummaryOutput;
  actionItems: ActionItemOutput[];
  participants: string[];
}): Promise<ReadableStream<Uint8Array>> {
  const env = getEnv();
  if (!env.OPENAI_API_KEY) {
    return stubStream("[Email generation unavailable — OPENAI_API_KEY not configured.]");
  }

  const client = getClient();
  const stream = await client.chat.completions.create({
    model: env.OPENAI_MODEL_PRIMARY,
    stream: true,
    // See streamGroundedAnswer. A recap email is a few hundred tokens.
    reasoning_effort: "low",
    max_completion_tokens: 4000,
    messages: [
      { role: "system", content: PROMPTS.emailSystem(params.type, params.tone) },
      {
        role: "user",
        content: PROMPTS.emailUser(params.summary, params.actionItems, params.participants),
      },
    ],
  });

  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta.content;
          if (delta) controller.enqueue(encoder.encode(delta));
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

// ----------------------------------------------------------------------------
// Stubs
// ----------------------------------------------------------------------------

function stubAnalysis(): AnalysisResult {
  return {
    summary: {
      executive: "[Summary pending — OPENAI_API_KEY not configured]",
      key_topics: [],
      decisions: [],
      open_questions: [],
      chapters: [],
    },
    action_items: [],
    cost_usd: 0,
  };
}

function stubScore(): MeetingScore {
  return {
    total: 0,
    participation: 0,
    actionability: 0,
    focus: 0,
    clarity: 0,
    efficiency: 0,
    explanation: "[Score pending — OPENAI_API_KEY not configured]",
  };
}

function stubStream(message: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(message));
      controller.close();
    },
  });
}
