/**
 * Server environment.
 *
 * The app runs on Node.js (Railway). Environment variables come from
 * process.env (production via Railway dashboard, local via .env / .dev.vars).
 */

import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  PORT: z.coerce.number().int().default(3000),

  // --- Data layer (Railway) ---
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

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
  GOOGLE_CLIENT_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment configuration");
  }
  cached = parsed.data;
  return cached;
}

export interface ProcessingJob {
  meeting_id: string;
  user_id: string;
  audio_key: string;
  language?: string;
  retry_count?: number;
}
