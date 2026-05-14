/**
 * Job queue (BullMQ over Redis).
 *
 * The API enqueues `ProcessingJob`s; the worker process in
 * src/server/workers/main.ts consumes them.
 */
import { Queue } from "bullmq";
import Redis from "ioredis";
import { getEnv } from "../env";
export const PROCESSING_QUEUE_NAME = "processing";
let _connection = null;
let _queue = null;
function getConnection() {
    if (_connection)
        return _connection;
    // BullMQ owns its own connection — must be a fresh ioredis instance per
    // queue/worker, NOT the shared cache client.
    const env = getEnv();
    _connection = new Redis(env.REDIS_URL, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
    });
    return _connection;
}
export function getProcessingQueue() {
    if (_queue)
        return _queue;
    _queue = new Queue(PROCESSING_QUEUE_NAME, {
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
export async function enqueueProcessingJob(job) {
    const queue = getProcessingQueue();
    await queue.add(`meeting:${job.meeting_id}`, job, {
        jobId: job.meeting_id, // idempotent: re-enqueues are deduped by job id
    });
}
export async function enqueueWithDelay(job, delaySeconds) {
    const queue = getProcessingQueue();
    await queue.add(`meeting:${job.meeting_id}`, job, {
        jobId: `${job.meeting_id}:retry:${Date.now()}`,
        delay: delaySeconds * 1000,
    });
}
export async function closeQueue() {
    if (_queue) {
        await _queue.close();
        _queue = null;
    }
    if (_connection && "quit" in _connection) {
        await _connection.quit();
        _connection = null;
    }
}
export { getConnection as getQueueConnection };
//# sourceMappingURL=queue.js.map