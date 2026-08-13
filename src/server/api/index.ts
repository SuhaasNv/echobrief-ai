/**
 * Hono API entrypoint.
 *
 * Mounted at /api/v1 by src/server.ts. All routes require a valid JWT EXCEPT
 * the public /share/:token route, which is mounted outside the auth gate.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { requestId } from "./middleware/request-id";
import { errorHandler } from "./middleware/error";
import { requireAuth } from "./middleware/auth";
import { requireWorkspace, requireProfessionalWorkspace } from "./middleware/workspace";
import { rateLimit } from "./middleware/rate-limit";
import {
  requireTranscriptionQuota,
  requireAIQueryQuota,
  requireFlashcardQuota,
} from "./middleware/quota";
import { securityHeaders } from "./middleware/security-headers";
import { requestLimits } from "./middleware/request-limits";
import { sentryMiddleware } from "./middleware/monitoring";
import { getEnv } from "../env";

import adminRoutes from "./routes/admin";
import authRoutes from "./routes/auth";
import googleAuthRoutes from "./routes/auth-google";
import healthRoutes from "./routes/health";
import revenueCatWebhookRoutes from "./routes/webhooks-revenuecat";
import docsRoutes from "./routes/docs";
import meetingsRoutes from "./routes/meetings";
import actionItemsRoutes from "./routes/action-items";
import chatRoutes from "./routes/chat";
import searchRoutes from "./routes/search";
import integrationsRoutes from "./routes/integrations";
import accountRoutes from "./routes/account";
import generateRoutes from "./routes/generate";
import shareRoutes from "./routes/share";
import workspacesRoutes from "./routes/workspaces";
import flashcardsRoutes from "./routes/flashcards";
import streamingRoutes from "./routes/streaming";
import analyticsRoutes from "./routes/analytics";
import subscriptionRoutes from "./routes/subscription";

import type { AppBindings } from "./types";

const api = new Hono<AppBindings>();

api.use("*", requestId);
api.use("*", sentryMiddleware); // Monitoring + error tracking
api.use("*", securityHeaders);
api.use("*", requestLimits); // DoS protection via size limits
api.use(
  "*",
  cors({
    origin: (origin) => {
      const env = getEnv();
      if (origin === env.APP_URL) return origin;
      if (env.NODE_ENV === "development") return origin ?? "*";
      return null;
    },
    credentials: true,
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["content-type", "authorization", "x-request-id", "x-workspace-id"],
    // Without this the browser strips these from cross-origin responses — and
    // the frontend is ALWAYS cross-origin (:8080 vs :4000 in dev, separate
    // Railway services in prod). x-citations silently read as null, so every
    // search answer rendered with zero sources.
    exposeHeaders: [
      "x-citations",
      // Same class of bug as x-citations: an Ask turn that resolved to an
      // action carries its whole payload here and an empty body, so a browser
      // stripping this header would render the instruction as a blank answer.
      "x-ask-action",
      "x-request-id",
      "retry-after",
      "x-ratelimit-limit",
      "x-ratelimit-remaining",
      "x-ratelimit-reset",
    ],
  }),
);

api.onError(errorHandler);

// Health checks (no auth, for load balancers / k8s probes)
api.route("/", healthRoutes);

// API documentation (no auth, public documentation)
api.route("/docs", docsRoutes);

// Public routes (no auth).
//
// These are the only endpoints an unauthenticated attacker can reach, so they
// carry their own IP-keyed budgets. /auth additionally runs per-email and
// per-(IP+email) counters inside the handlers — see checkAuthRateLimit.
api.use("/auth/*", rateLimit("auth_ip"));
api.use("/share/*", rateLimit("share"));
// Its own bucket, NOT `general` — general is the sole fail-open bucket, and an
// unauthenticated endpoint that writes subscription tiers must refuse rather
// than wave traffic through when Redis is unreachable.
api.use("/webhooks/*", rateLimit("webhook"));

api.route("/auth", authRoutes);
api.route("/auth", googleAuthRoutes);
api.route("/share", shareRoutes);
// Public by necessity: RevenueCat's servers hold no session. Every guard the
// missing auth would have provided lives inside the handler — shared-secret
// verification, environment separation, idempotency and ordering.
api.route("/webhooks", revenueCatWebhookRoutes);

// Protected routes
const protectedApi = new Hono<AppBindings>();
protectedApi.use("*", requireAuth);

protectedApi.use("/meetings/*", rateLimit("general"));
protectedApi.use("/action-items/*", rateLimit("general"));
protectedApi.use("/account/*", rateLimit("general"));
protectedApi.use("/integrations/*", rateLimit("general"));
protectedApi.use("/workspaces/*", rateLimit("general"));
protectedApi.use("/flashcards/*", rateLimit("general"));
protectedApi.use("/analytics/*", rateLimit("general"));
protectedApi.use("/subscription/*", rateLimit("general"));
protectedApi.use("/admin/*", rateLimit("general"));

// Ingest endpoints get their own hourly budget on top of `general`. Each call
// can commit us to a multi-hour AssemblyAI job and a 500MB R2 object, so 100
// req/min of `general` headroom is the wrong unit entirely.
protectedApi.use("/meetings/upload-url", rateLimit("upload"));
protectedApi.use("/meetings/from-transcript", rateLimit("upload"));
protectedApi.use("/meetings/from-live", rateLimit("upload"));

protectedApi.use("/search", rateLimit("ai"));
protectedApi.use("/generate/*", rateLimit("ai"));
protectedApi.use("/meetings/:id/chat", rateLimit("ai"));
// Flashcard generation is an LLM call — gate it under the AI bucket too.
protectedApi.use("/meetings/:id/flashcards/generate", rateLimit("ai"));
// Each streaming token maps to a paid live transcription session.
protectedApi.use("/streaming/*", rateLimit("ai"));

// Workspaces CRUD is workspace-agnostic (you need to list them to switch).
protectedApi.route("/workspaces", workspacesRoutes);

// Subscription management is workspace-agnostic (user-level).
protectedApi.route("/subscription", subscriptionRoutes);

// Everything below this line operates inside an active workspace.
protectedApi.use("/meetings/*", requireWorkspace);
protectedApi.use("/action-items/*", requireWorkspace);
protectedApi.use("/search", requireWorkspace);
protectedApi.use("/flashcards/*", requireWorkspace);
protectedApi.use("/integrations/*", requireWorkspace);
protectedApi.use("/generate/*", requireWorkspace);
protectedApi.use("/streaming/*", requireWorkspace);
protectedApi.use("/analytics/*", requireWorkspace);
// Only this one path under /account. The rest of /account is workspace-agnostic
// on purpose — requireWorkspace answers 409 for a user who has no workspace
// yet, and locking /account/me behind that would make a half-provisioned
// account unable to load its own profile or delete itself.
protectedApi.use("/account/preferences", requireWorkspace);

// Pro-only carve-outs (server-side enforcement, not just UI-hide).
protectedApi.use("/integrations/*", requireProfessionalWorkspace());
protectedApi.use("/generate/email", requireProfessionalWorkspace());
protectedApi.use("/action-items/:id/export", requireProfessionalWorkspace());

// Plan quotas. These were written, unit-tested, and then never mounted — the
// tier limits in TIER_LIMITS only ever rendered in the UI while every endpoint
// answered without checking them. Rate limits bound requests per minute; these
// bound usage per billing period, so both are needed.
protectedApi.use("/meetings/upload-url", requireTranscriptionQuota);
/**
 * The SEGMENTED path — the one the mobile app actually records through.
 *
 * These were missing, so the app's primary recording route was metered by
 * nothing at all: not the transcription quota, and not the `upload` rate bucket
 * that rate-limit.ts calls "a money budget, not a traffic budget". It sat inside
 * `general` alone, which is 100/min AND the only fail-open bucket in the system.
 *
 * The exposure was not theoretical. A single 500 MiB segmented recording at the
 * recorder's own 64 kbps is roughly 18 hours of audio — about 3.6x the entire
 * free-tier monthly allowance, committed in one uncounted meeting.
 *
 * `/segmented` is where the meeting is created, so it is the admission point and
 * gets both gates. `/segments/complete` is where the transcription is actually
 * queued, so it gets the quota too — a client that skipped straight to finalize
 * would otherwise still buy a pipeline run.
 */
protectedApi.use("/meetings/segmented", requireTranscriptionQuota);
protectedApi.use("/meetings/segmented", rateLimit("upload"));
protectedApi.use("/meetings/:id/segments/complete", requireTranscriptionQuota);
/**
 * Retry re-runs the whole pipeline — transcription included — so it spends real
 * money. The route caps attempts at 3 per meeting, which bounds it per meeting
 * but not per account.
 */
protectedApi.use("/meetings/:id/retry", requireTranscriptionQuota);
protectedApi.use("/streaming/*", requireTranscriptionQuota);
protectedApi.use("/meetings/:id/chat", requireAIQueryQuota);
protectedApi.use("/search", requireAIQueryQuota);
protectedApi.use("/generate/*", requireAIQueryQuota);
protectedApi.use("/meetings/:id/flashcards/generate", requireFlashcardQuota);

protectedApi.route("/meetings", meetingsRoutes);
protectedApi.route("/meetings", chatRoutes);
protectedApi.route("/", flashcardsRoutes);
protectedApi.route("/streaming", streamingRoutes);
protectedApi.route("/action-items", actionItemsRoutes);
protectedApi.route("/search", searchRoutes);
protectedApi.route("/integrations", integrationsRoutes);
protectedApi.route("/account", accountRoutes);
protectedApi.route("/generate", generateRoutes);
protectedApi.route("/analytics", analyticsRoutes);
protectedApi.route("/admin", adminRoutes);

api.route("/", protectedApi);

export default api;
