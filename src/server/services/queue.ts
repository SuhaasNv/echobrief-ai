/**
 * Job queue (BullMQ over Redis).
 *
 * The API enqueues `ProcessingJob`s; the worker process in
 * src/server/workers/main.ts consumes them.
 */

import { Queue, type ConnectionOptions } from "bullmq";
import Redis from "ioredis";
import { getEnv, type ProcessingJob, type ExportJob } from "../env";

export const PROCESSING_QUEUE_NAME = "processing";
export const EXPORT_QUEUE_NAME = "account-export";

let _connection: ConnectionOptions | null = null;
let _queue: Queue<ProcessingJob> | null = null;
let _exportQueue: Queue<ExportJob> | null = null;

function getConnection(): ConnectionOptions {
  if (_connection) return _connection;
  // BullMQ owns its own connection — must be a fresh ioredis instance per
  // queue/worker, NOT the shared cache client.
  const env = getEnv();
  _connection = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  return _connection;
}

export function getProcessingQueue(): Queue<ProcessingJob> {
  if (_queue) return _queue;
  _queue = new Queue<ProcessingJob>(PROCESSING_QUEUE_NAME, {
    connection: getConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: { count: 1000, age: 60 * 60 * 24 * 7 },
      removeOnFail: { count: 500, age: 60 * 60 * 24 * 30 },
    },
  });
  return _queue;
}

export async function enqueueProcessingJob(job: ProcessingJob): Promise<void> {
  const queue = getProcessingQueue();
  await queue.add(`meeting:${job.meeting_id}`, job, {
    jobId: job.meeting_id, // idempotent: re-enqueues are deduped by job id
  });
}

export async function enqueueWithDelay(job: ProcessingJob, delaySeconds: number): Promise<void> {
  const queue = getProcessingQueue();
  await queue.add(`meeting:${job.meeting_id}`, job, {
    jobId: `${job.meeting_id}:retry:${Date.now()}`,
    delay: delaySeconds * 1000,
  });
}

export function getExportQueue(): Queue<ExportJob> {
  if (_exportQueue) return _exportQueue;
  _exportQueue = new Queue<ExportJob>(EXPORT_QUEUE_NAME, {
    connection: getConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: { count: 100, age: 60 * 60 * 24 * 7 },
      removeOnFail: { count: 50, age: 60 * 60 * 24 * 30 },
    },
  });
  return _exportQueue;
}

export async function enqueueExportJob(job: ExportJob): Promise<void> {
  const queue = getExportQueue();
  await queue.add(`export:${job.user_id}`, job, {
    jobId: `export:${job.user_id}:${Date.now()}`, // Allow multiple exports per user
  });
}

export async function closeQueue(): Promise<void> {
  if (_queue) {
    await _queue.close();
    _queue = null;
  }
  if (_exportQueue) {
    await _exportQueue.close();
    _exportQueue = null;
  }
  if (_connection && "quit" in _connection) {
    await (_connection as Redis).quit();
    _connection = null;
  }
}

export { getConnection as getQueueConnection };
