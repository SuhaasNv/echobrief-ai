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
import { securityHeaders } from "./middleware/security-headers";
import { requestLimits } from "./middleware/request-limits";
import { sentryMiddleware } from "./middleware/monitoring";
import { getEnv } from "../env";

import adminRoutes from "./routes/admin";
import authRoutes from "./routes/auth";
import healthRoutes from "./routes/health";
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

// Public routes (no auth)
api.route("/auth", authRoutes);
api.route("/share", shareRoutes);

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

// Pro-only carve-outs (server-side enforcement, not just UI-hide).
protectedApi.use("/integrations/*", requireProfessionalWorkspace());
protectedApi.use("/generate/email", requireProfessionalWorkspace());
protectedApi.use("/action-items/:id/export", requireProfessionalWorkspace());

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
