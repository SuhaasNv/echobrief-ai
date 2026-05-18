/**
 * /api/v1/streaming — token broker for AssemblyAI Universal-Streaming.
 *
 * The browser POSTs here to receive a short-lived, single-use AssemblyAI
 * token and the WebSocket URL. It then connects directly to AssemblyAI —
 * our API never relays audio.
 *
 * For long sessions (> 10 min) the recorder UI re-fetches a token before
 * the old one expires. This endpoint is rate-limited under the `ai` bucket
 * since each issued token typically maps to a paid streaming session.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { createStreamingToken } from "../../services/assemblyai";
import type { AppBindings } from "../types";

const app = new Hono<AppBindings>();

const TokenBody = z
  .object({
    expires_in_seconds: z.number().int().min(60).max(600).optional(),
    max_session_duration_seconds: z.number().int().min(60).max(10_800).optional(),
  })
  .optional();

app.post("/token", zValidator("json", TokenBody), async (c) => {
  const body = c.req.valid("json") ?? {};
  const result = await createStreamingToken({
    expiresInSeconds: body.expires_in_seconds,
    maxSessionDurationSeconds: body.max_session_duration_seconds,
  });

  return c.json(result);
});

export default app;
