/**
 * EchoBrief API server (Node.js).
 *
 * Standalone process: Hono API mounted at /api/v1, served by @hono/node-server.
 * Deployed as a Railway service. The BullMQ worker is a sibling process
 * (src/server/workers/main.ts) — same image, different start command.
 */

import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import api from "./server/api";
import { getEnv } from "./server/env";
import { closeSql } from "./server/db";
import { closeRedis } from "./server/services/redis";
import { closeQueue } from "./server/services/queue";

const app = new Hono();
app.route("/api/v1", api);
app.get("/", (c) => c.json({ service: "echobrief-api", ok: true }));

const env = getEnv();

const server = serve(
  {
    fetch: app.fetch,
    port: env.PORT,
    hostname: "0.0.0.0",
  },
  (info) => {
    console.log(`[api] listening on http://0.0.0.0:${info.port}`);
  },
);

async function shutdown(signal: string) {
  console.log(`[api] received ${signal}, shutting down...`);
  server.close(async () => {
    await closeSql();
    await closeRedis();
    await closeQueue();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
