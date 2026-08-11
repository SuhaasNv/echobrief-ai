/**
 * Quota enforcement middleware.
 *
 * Middleware that checks if a user has quota remaining before allowing expensive
 * operations like transcription, AI queries, or flashcard generation.
 *
 * Usage:
 *   app.post("/upload", requireTranscriptionQuota, async (c) => { ... });
 *   app.post("/chat", requireAIQueryQuota, async (c) => { ... });
 */

import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { checkQuota } from "../../services/usage-tracker";
import type { AppBindings } from "../types";

interface QuotaRequestBody {
  /** Wire format is snake_case — see UploadUrlRequest in src/lib/schemas.ts. */
  duration_sec?: number;
}

/**
 * Check if user has remaining transcription quota.
 *
 * SECURITY: This middleware expects the route to validate the body FIRST using
 * zValidator. It reads from c.req.valid("json") which contains validated data.
 *
 * Attach this to upload endpoints AFTER zValidator:
 *   app.post("/upload", zValidator("json", schema), requireTranscriptionQuota, handler);
 *
 * On quota exceeded, returns 429 with upgrade message.
 */
export const requireTranscriptionQuota = createMiddleware<AppBindings>(async (c, next) => {
  const user = c.get("user");

  // SECURITY: Read validated body (set by zValidator middleware)
  // If route doesn't use zValidator, this will throw an error (fail-safe)
  let body: QuotaRequestBody | undefined;
  try {
    body = (c.req.valid as unknown as (target: string) => QuotaRequestBody)("json");
  } catch {
    // Ignore and fall through to manual parsing
  }

  if (!body) {
    try {
      body = (await c.req.json()) as QuotaRequestBody;
    } catch {
      body = {};
    }
  }

  // Was reading `durationSec`, which the client never sends — so this always
  // resolved to 0 minutes and the check only tripped for users ALREADY over
  // their limit. The schema field is `duration_sec`.
  const durationSec = body?.duration_sec ?? 0;

  // SECURITY: Strict validation to prevent quota bypass attacks
  if (typeof durationSec !== "number") {
    throw new HTTPException(400, { message: "Invalid duration: must be a number" });
  }
  if (durationSec < 0) {
    throw new HTTPException(400, { message: "Invalid duration: cannot be negative" });
  }
  if (durationSec > 36000) {
    throw new HTTPException(400, { message: "Invalid duration: maximum 10 hours (36000 seconds)" });
  }
  if (!Number.isFinite(durationSec)) {
    throw new HTTPException(400, { message: "Invalid duration: must be a finite number" });
  }

  const minutes = Math.ceil(durationSec / 60);

  const result = await checkQuota(user.id, "transcription", minutes);

  if (!result.allowed) {
    throw new HTTPException(429, {
      message: result.reason,
      res: new Response(
        JSON.stringify({
          error: "quota_exceeded",
          message: result.reason,
          tier: result.tier,
          current: result.current,
          limit: result.limit,
        }),
        {
          status: 429,
          headers: { "content-type": "application/json" },
        },
      ),
    });
  }

  await next();
});

/**
 * Check if user has remaining AI query quota.
 *
 * Attach this to chat and search endpoints. On quota exceeded, returns 429 with
 * upgrade message.
 */
export const requireAIQueryQuota = createMiddleware<AppBindings>(async (c, next) => {
  const user = c.get("user");

  const result = await checkQuota(user.id, "ai_query", 1);

  if (!result.allowed) {
    throw new HTTPException(429, {
      message: result.reason,
      res: new Response(
        JSON.stringify({
          error: "quota_exceeded",
          message: result.reason,
          tier: result.tier,
          current: result.current,
          limit: result.limit,
        }),
        {
          status: 429,
          headers: { "content-type": "application/json" },
        },
      ),
    });
  }

  await next();
});

/**
 * Check if user has remaining flashcard generation quota.
 *
 * Attach this to flashcard generation endpoint. On quota exceeded, returns 429
 * with upgrade message.
 */
export const requireFlashcardQuota = createMiddleware<AppBindings>(async (c, next) => {
  const user = c.get("user");

  const result = await checkQuota(user.id, "flashcard", 1);

  if (!result.allowed) {
    throw new HTTPException(429, {
      message: result.reason,
      res: new Response(
        JSON.stringify({
          error: "quota_exceeded",
          message: result.reason,
          tier: result.tier,
          current: result.current,
          limit: result.limit,
        }),
        {
          status: 429,
          headers: { "content-type": "application/json" },
        },
      ),
    });
  }

  await next();
});
