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
import { ANALYSIS_SCHEMA, SCORE_SCHEMA, PROMPTS, } from "../lib/prompts";
let _client = null;
function getClient() {
    if (_client)
        return _client;
    const env = getEnv();
    if (!env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY not configured");
    }
    _client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    return _client;
}
// ----------------------------------------------------------------------------
// Summary + action items (single call, structured output)
// ----------------------------------------------------------------------------
export async function analyzeMeeting(transcript) {
    const env = getEnv();
    if (!env.OPENAI_API_KEY)
        return stubAnalysis();
    const client = getClient();
    const response = await client.chat.completions.create({
        model: env.OPENAI_MODEL_PRIMARY,
        temperature: 0.3,
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
    if (!raw)
        throw new Error("OpenAI returned no content");
    const parsed = JSON.parse(raw);
    const usage = response.usage;
    const cost_usd = usage
        ? (usage.prompt_tokens / 1_000_000) * 5 + (usage.completion_tokens / 1_000_000) * 15
        : 0;
    return {
        summary: parsed.summary,
        action_items: parsed.action_items,
        cost_usd,
    };
}
// ----------------------------------------------------------------------------
// Meeting score (light model)
// ----------------------------------------------------------------------------
export async function scoreMeeting(transcript, speakerStats, actionItemCount) {
    const env = getEnv();
    if (!env.OPENAI_API_KEY)
        return { score: stubScore(), cost_usd: 0 };
    const client = getClient();
    const response = await client.chat.completions.create({
        model: env.OPENAI_MODEL_LIGHT,
        temperature: 0.3,
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
    if (!raw)
        throw new Error("OpenAI returned no content for score");
    const score = JSON.parse(raw);
    const usage = response.usage;
    const cost_usd = usage
        ? (usage.prompt_tokens / 1_000_000) * 0.5 + (usage.completion_tokens / 1_000_000) * 2
        : 0;
    return { score, cost_usd };
}
// ----------------------------------------------------------------------------
// Streaming Q&A
// ----------------------------------------------------------------------------
export async function streamGroundedAnswer(params) {
    const env = getEnv();
    if (!env.OPENAI_API_KEY) {
        return stubStream("[OpenAI API key not configured — set OPENAI_API_KEY in .env to enable AI chat.]");
    }
    const client = getClient();
    const stream = await client.chat.completions.create({
        model: env.OPENAI_MODEL_PRIMARY,
        temperature: 0.3,
        stream: true,
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
                    if (delta)
                        controller.enqueue(encoder.encode(delta));
                }
                controller.close();
            }
            catch (err) {
                controller.error(err);
            }
        },
    });
}
// ----------------------------------------------------------------------------
// Email generation (streaming, freeform — no structured schema needed)
// ----------------------------------------------------------------------------
export async function generateEmail(params) {
    const env = getEnv();
    if (!env.OPENAI_API_KEY) {
        return stubStream("[Email generation unavailable — OPENAI_API_KEY not configured.]");
    }
    const client = getClient();
    const stream = await client.chat.completions.create({
        model: env.OPENAI_MODEL_PRIMARY,
        temperature: 0.7,
        stream: true,
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
                    if (delta)
                        controller.enqueue(encoder.encode(delta));
                }
                controller.close();
            }
            catch (err) {
                controller.error(err);
            }
        },
    });
}
// ----------------------------------------------------------------------------
// Stubs
// ----------------------------------------------------------------------------
function stubAnalysis() {
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
function stubScore() {
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
function stubStream(message) {
    const encoder = new TextEncoder();
    return new ReadableStream({
        start(controller) {
            controller.enqueue(encoder.encode(message));
            controller.close();
        },
    });
}
//# sourceMappingURL=llm.js.map