/**
 * Worker process entrypoint.
 *
 * Run as a separate Railway service:
 *   node dist/server/workers/main.js
 *   (or: tsx src/server/workers/main.ts for dev)
 *
 * BullMQ Workers consume the `processing` and `export` queues and run jobs.
 * 
 * SCALABILITY: Concurrency tuned for production load.
 * - Processing: 10 concurrent jobs per worker (up from 1)
 * - Export: 5 concurrent jobs per worker (up from 2)
 * - Deploy 10 worker instances for 1M users → 100 total parallel jobs
 * 
 * Environment Variables:
 * - WORKER_CONCURRENCY: Processing worker concurrency (default: 10)
 * - EXPORT_WORKER_CONCURRENCY: Export worker concurrency (default: 5)
 */

import "dotenv/config";
import { Worker } from "bullmq";
import { PROCESSING_QUEUE_NAME, EXPORT_QUEUE_NAME, getQueueConnection } from "../services/queue";
import { processMeeting, markFailed } from "./processing";
import { exportUserAccount, type ExportJob } from "./export-account";
import { closeSql } from "../db";
import { closeRedis } from "../services/redis";
import type { ProcessingJob } from "../env";
import { cleanupOldAudioFiles } from "./cleanup-r2";

// SCALABILITY: Configurable concurrency via environment variables
const PROCESSING_CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || "10");
const EXPORT_CONCURRENCY = parseInt(process.env.EXPORT_WORKER_CONCURRENCY || "5");

console.log(`[worker] starting with concurrency: ${PROCESSING_CONCURRENCY}`);
console.log(`[export-worker] starting with concurrency: ${EXPORT_CONCURRENCY}`);

const worker = new Worker<ProcessingJob>(
  PROCESSING_QUEUE_NAME,
  async (job) => {
    console.log(`[worker] processing ${job.id}`);
    await processMeeting(job.data);
  },
  {
    connection: getQueueConnection(),
    concurrency: PROCESSING_CONCURRENCY,  // ✅ Up from 1 to 10 (or env var)
    lockDuration: 15 * 60 * 1000,         // 15 minutes; AI pipeline can be slow
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

// ===== Export Worker =====
// Background worker for account data exports (GDPR compliance).
// Generates ZIP archives with all user data and sends download link via email.

const exportWorker = new Worker<ExportJob>(
  EXPORT_QUEUE_NAME,
  async (job) => {
    console.log(`[export-worker] processing ${job.id}`);
    await exportUserAccount(job.data);
  },
  {
    connection: getQueueConnection(),
    concurrency: EXPORT_CONCURRENCY,  // ✅ Up from 2 to 5 (or env var)
    lockDuration: 10 * 60 * 1000,     // 10 minutes; exports can take time
  },
);

exportWorker.on("failed", async (job, err) => {
  if (!job) return;
  console.error(`[export-worker] job ${job.id} failed (attempt ${job.attemptsMade}/${job.opts.attempts}):`, err.message);
  // BullMQ retries automatically; final failures are logged here
});

exportWorker.on("completed", (job) => {
  console.log(`[export-worker] job ${job.id} complete`);
});

exportWorker.on("error", (err) => {
  console.error("[export-worker-error]", err);
});

// ===== R2 Cleanup Scheduler =====
// Runs daily at 3:00 AM to delete audio files older than 7 days.
// Saves R2 storage costs by automatically removing old recordings.

const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
let cleanupTimer: NodeJS.Timeout | null = null;

function scheduleNextCleanup() {
  // Calculate time until next 3:00 AM
  const now = new Date();
  const next3am = new Date(now);
  next3am.setHours(3, 0, 0, 0);
  
  // If 3 AM already passed today, schedule for tomorrow
  if (next3am <= now) {
    next3am.setDate(next3am.getDate() + 1);
  }
  
  const msUntilNext = next3am.getTime() - now.getTime();
  
  console.log(`[r2-cleanup] scheduled for ${next3am.toISOString()} (in ${Math.round(msUntilNext / 1000 / 60)} minutes)`);
  
  cleanupTimer = setTimeout(async () => {
    try {
      await cleanupOldAudioFiles();
    } catch (error) {
      console.error("[r2-cleanup] failed:", error);
    }
    // Schedule next run after this one completes
    scheduleNextCleanup();
  }, msUntilNext);
}

// Start the cleanup scheduler
scheduleNextCleanup();

// Optional: Run cleanup immediately on startup (useful for testing)
// Uncomment the line below to run cleanup when worker starts:
// cleanupOldAudioFiles().catch((err) => console.error("[r2-cleanup] startup run failed:", err));


async function shutdown(signal: string) {
  console.log(`[worker] received ${signal}, shutting down gracefully...`);
  
  // 1. Stop accepting new jobs
  console.log("[worker] Pausing workers (no new jobs accepted)...");
  await worker.pause();
  await exportWorker.pause();
  
  // 2. Clear cleanup timer
  if (cleanupTimer) {
    clearTimeout(cleanupTimer);
    console.log("[r2-cleanup] timer cleared");
  }
  
  // 3. Wait for in-flight jobs to complete (with timeout)
  const shutdownTimeout = setTimeout(() => {
    console.warn("[worker] Shutdown timeout reached, forcing exit");
    process.exit(1);
  }, 30_000); // 30 seconds max wait
  
  try {
    console.log("[worker] Waiting for in-flight jobs to complete (max 30s)...");
    await worker.close();
    await exportWorker.close();
    clearTimeout(shutdownTimeout);
    console.log("[worker] All jobs completed gracefully");
  } catch (err) {
    console.error("[worker] Error during graceful shutdown:", err);
    clearTimeout(shutdownTimeout);
  }
  
  // 4. Close connections
  console.log("[worker] Closing database and Redis connections...");
  await closeSql();
  await closeRedis();
  
  console.log("[worker] Shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

console.log(`[worker] listening on queue "${PROCESSING_QUEUE_NAME}"`);
console.log(`[export-worker] listening on queue "${EXPORT_QUEUE_NAME}"`);
