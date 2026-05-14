/**
 * OpenAI embeddings service. (LLM calls live in services/llm.ts.)
 *
 * text-embedding-3-small at 1536d — used for chunk indexing and query
 * embedding at search time. Vectors are stored in Railway Postgres via the
 * pgvector extension.
 */
import OpenAI from "openai";
import { getEnv } from "../env";
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIM = 1536;
const BATCH_SIZE = 100;
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
export async function embedQuery(text) {
    const env = getEnv();
    if (!env.OPENAI_API_KEY)
        return zeroVector();
    const client = getClient();
    const response = await client.embeddings.create({
        model: EMBEDDING_MODEL,
        input: text,
    });
    return response.data[0].embedding;
}
export async function embedChunks(chunks) {
    const env = getEnv();
    if (!env.OPENAI_API_KEY || chunks.length === 0) {
        return { embeddings: chunks.map(() => zeroVector()), cost_usd: 0 };
    }
    const client = getClient();
    const embeddings = [];
    let totalTokens = 0;
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        const batch = chunks.slice(i, i + BATCH_SIZE);
        const response = await client.embeddings.create({
            model: EMBEDDING_MODEL,
            input: batch,
        });
        embeddings.push(...response.data.map((d) => d.embedding));
        totalTokens += response.usage.total_tokens;
    }
    const cost_usd = (totalTokens / 1_000_000) * 0.02;
    return { embeddings, cost_usd };
}
function zeroVector() {
    return new Array(EMBEDDING_DIM).fill(0);
}
//# sourceMappingURL=openai.js.map