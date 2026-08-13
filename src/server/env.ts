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

  // --- Auth (self-hosted JWT) ---
  // Symmetric secret used to sign + verify HS256 JWTs. 32+ chars required.
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be 32+ chars"),

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
    console.error("❌ Invalid environment configuration:");
    console.error(JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));

    // In production, fail fast - don't start with invalid config
    if (process.env.NODE_ENV === "production") {
      throw new Error("Cannot start in production with invalid environment configuration");
    }

    // In development, warn but continue (for local dev convenience)
    console.warn("⚠️  Continuing in development mode with partial configuration");
    console.warn("⚠️  Some features may not work correctly");
  }

  cached = parsed.data || ({} as Env);

  // Warn about missing optional features
  if (!cached.OPENAI_API_KEY) {
    console.warn("⚠️  OPENAI_API_KEY not set - AI features will be stubbed/disabled");
  }
  if (!cached.ASSEMBLYAI_API_KEY) {
    console.warn("⚠️  ASSEMBLYAI_API_KEY not set - transcription will fail");
  }
  if (!cached.RESEND_API_KEY) {
    console.warn("⚠️  RESEND_API_KEY not set - email notifications disabled");
  }
  if (!cached.R2_ACCESS_KEY_ID || !cached.R2_SECRET_ACCESS_KEY) {
    console.warn("⚠️  R2 credentials not set - audio storage will fail");
  }

  // Log configuration summary in development
  if (cached.NODE_ENV === "development") {
    console.log("[ENV] Configuration loaded:");
    console.log("  - NODE_ENV:", cached.NODE_ENV);
    // Must track the default in src/server/db/index.ts — a boot log that reports
    // a pool size the process is not using is worse than no log at all.
    console.log("  - DB pool size:", process.env.DB_POOL_SIZE || "12 (default)");
    console.log("  - Worker concurrency:", process.env.WORKER_CONCURRENCY || "10 (default)");
    console.log(
      "  - Export worker concurrency:",
      process.env.EXPORT_WORKER_CONCURRENCY || "5 (default)",
    );
    console.log("  - Redis pool size:", process.env.REDIS_POOL_SIZE || "10 (default)");
    console.log("  - OpenAI:", cached.OPENAI_API_KEY ? "✓ configured" : "✗ missing");
    console.log("  - AssemblyAI:", cached.ASSEMBLYAI_API_KEY ? "✓ configured" : "✗ missing");
    console.log("  - Resend:", cached.RESEND_API_KEY ? "✓ configured" : "✗ missing");
    console.log(
      "  - R2:",
      cached.R2_ACCESS_KEY_ID && cached.R2_SECRET_ACCESS_KEY ? "✓ configured" : "✗ missing",
    );
    console.log("  - Sentry:", process.env.SENTRY_DSN ? "✓ configured" : "✗ missing");
  }

  return cached;
}

export interface ProcessingJob {
  meeting_id: string;
  user_id: string;
  audio_key: string;
  language?: string;
  retry_count?: number;
}

export interface ExportJob {
  user_id: string;
  email: string;
}
