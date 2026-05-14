/**
 * Worker process entrypoint.
 *
 * Run as a separate Railway service:
 *   node dist/server/workers/main.js
 *   (or: tsx src/server/workers/main.ts for dev)
 *
 * One BullMQ Worker consumes the `processing` queue and runs the AI pipeline
 * defined in processing.ts. Concurrency is intentionally low (1) so a single
 * meeting doesn't hog all Postgres connections via embeddings batching.
 */

import "dotenv/config";
import { Worker } from "bullmq";
import { PROCESSING_QUEUE_NAME, getQueueConnection } from "../services/queue";
import { processMeeting, markFailed } from "./processing";
import { closeSql } from "../db";
import { closeRedis } from "../services/redis";
import type { ProcessingJob } from "../env";

const worker = new Worker<ProcessingJob>(
  PROCESSING_QUEUE_NAME,
  async (job) => {
    console.log(`[worker] processing ${job.id}`);
    await processMeeting(job.data);
  },
  {
    connection: getQueueConnection(),
    concurrency: 1,
    lockDuration: 15 * 60 * 1000, // 15 minutes; AI pipeline can be slow
  },
);

worker.on("failed", async (job, err) => {
  if (!job) return;
  console.error(`[worker] job ${job.id} failed (attempt ${job.attemptsMade}/${job.opts.attempts}):`, err.message);
  // BullMQ retries automatically; only mark final-failed once attempts exhausted.
  if (job.attemptsMade >= (job.opts.attempts ?? 3)) {
    await markFailed(job.data, err);
  }
});

worker.on("completed", (job) => {
  console.log(`[worker] job ${job.id} complete`);
});

worker.on("error", (err) => {
  console.error("[worker-error]", err);
});

async function shutdown(signal: string) {
  console.log(`[worker] received ${signal}, shutting down...`);
  await worker.close();
  await closeSql();
  await closeRedis();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

console.log(`[worker] listening on queue "${PROCESSING_QUEUE_NAME}"`);
