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
import { rateLimit } from "./middleware/rate-limit";
import { getEnv } from "../env";

import meetingsRoutes from "./routes/meetings";
import actionItemsRoutes from "./routes/action-items";
import chatRoutes from "./routes/chat";
import searchRoutes from "./routes/search";
import integrationsRoutes from "./routes/integrations";
import accountRoutes from "./routes/account";
import generateRoutes from "./routes/generate";
import shareRoutes from "./routes/share";

import type { AppBindings } from "./types";

const api = new Hono<AppBindings>();

api.use("*", requestId);
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
    allowHeaders: ["content-type", "authorization", "x-request-id"],
  }),
);

api.onError(errorHandler);

api.get("/health", (c) => c.json({ ok: true, env: getEnv().NODE_ENV }));

// Public routes (no auth)
api.route("/share", shareRoutes);

// Protected routes
const protectedApi = new Hono<AppBindings>();
protectedApi.use("*", requireAuth);

protectedApi.use("/meetings/*", rateLimit("general"));
protectedApi.use("/action-items/*", rateLimit("general"));
protectedApi.use("/account/*", rateLimit("general"));
protectedApi.use("/integrations/*", rateLimit("general"));

protectedApi.use("/search", rateLimit("ai"));
protectedApi.use("/generate/*", rateLimit("ai"));
protectedApi.use("/meetings/:id/chat", rateLimit("ai"));

protectedApi.route("/meetings", meetingsRoutes);
protectedApi.route("/meetings", chatRoutes);
protectedApi.route("/action-items", actionItemsRoutes);
protectedApi.route("/search", searchRoutes);
protectedApi.route("/integrations", integrationsRoutes);
protectedApi.route("/account", accountRoutes);
protectedApi.route("/generate", generateRoutes);

api.route("/", protectedApi);

export default api;
