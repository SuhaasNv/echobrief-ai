/**
 * Worker monitoring routes for admin dashboard.
 * 
 * Provides real-time visibility into worker queue health:
 * - Queue depth (waiting, active, completed, failed jobs)
 * - Worker throughput metrics
 * - Job failure rates
 * - System health indicators
 * 
 * Mount at: /api/v1/admin/workers
 * Auth: Requires admin role
 */

import { Hono } from "hono";
import { requireAdmin } from "../middleware/auth";
import { getProcessingQueue, getQueueConnection } from "../../services/queue";
import { Queue } from "bullmq";

const app = new Hono();

// All routes require admin authentication
app.use("*", requireAdmin);

/**
 * GET /api/v1/admin/workers/stats
 * 
 * Returns queue statistics for monitoring dashboard.
 */
app.get("/stats", async (c) => {
  const processingQueue = getProcessingQueue();
  const connection = getQueueConnection();
  
  // Get export queue (same connection, different name)
  const exportQueue = new Queue("export", { connection });
  
  try {
    // Fetch queue counts in parallel
    const [
      processingWaiting,
      processingActive,
      processingCompleted,
      processingFailed,
      exportWaiting,
      exportActive,
      exportCompleted,
      exportFailed,
    ] = await Promise.all([
      processingQueue.getWaitingCount(),
      processingQueue.getActiveCount(),
      processingQueue.getCompletedCount(),
      processingQueue.getFailedCount(),
      exportQueue.getWaitingCount(),
      exportQueue.getActiveCount(),
      exportQueue.getCompletedCount(),
      exportQueue.getFailedCount(),
    ]);
    
    return c.json({
      processing_queue: {
        waiting: processingWaiting,
        active: processingActive,
        completed: processingCompleted,
        failed: processingFailed,
        total: processingWaiting + processingActive + processingCompleted + processingFailed,
        health: processingFailed / Math.max(1, processingCompleted + processingFailed) < 0.05 ? "healthy" : "degraded",
      },
      export_queue: {
        waiting: exportWaiting,
        active: exportActive,
        completed: exportCompleted,
        failed: exportFailed,
        total: exportWaiting + exportActive + exportCompleted + exportFailed,
        health: exportFailed / Math.max(1, exportCompleted + exportFailed) < 0.05 ? "healthy" : "degraded",
      },
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("[Admin] Failed to fetch worker stats:", error);
    return c.json(
      {
        error: "failed_to_fetch_stats",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

/**
 * GET /api/v1/admin/workers/failed
 * 
 * Returns recent failed jobs for debugging.
 */
app.get("/failed", async (c) => {
  const processingQueue = getProcessingQueue();
  
  try {
    const failedJobs = await processingQueue.getFailed(0, 20); // Last 20 failures
    
    const jobs = failedJobs.map((job) => ({
      id: job.id,
      name: job.name,
      data: job.data,
      failedReason: job.failedReason,
      attemptsMade: job.attemptsMade,
      timestamp: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
    }));
    
    return c.json({
      failed_jobs: jobs,
      count: jobs.length,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("[Admin] Failed to fetch failed jobs:", error);
    return c.json(
      {
        error: "failed_to_fetch_jobs",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

/**
 * POST /api/v1/admin/workers/retry/:jobId
 * 
 * Retry a specific failed job.
 */
app.post("/retry/:jobId", async (c) => {
  const jobId = c.req.param("jobId");
  const processingQueue = getProcessingQueue();
  
  try {
    const job = await processingQueue.getJob(jobId);
    
    if (!job) {
      return c.json({ error: "job_not_found" }, 404);
    }
    
    await job.retry();
    
    return c.json({
      success: true,
      job_id: jobId,
      message: "Job retried successfully",
    });
  } catch (error) {
    console.error(`[Admin] Failed to retry job ${jobId}:`, error);
    return c.json(
      {
        error: "retry_failed",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

export default app;
