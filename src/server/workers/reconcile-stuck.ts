import { getSql } from "../db";
import { getProcessingQueue } from "../services/queue";
import type { ProcessingJob } from "../env";

/**
 * Move interrupted meetings out of a non-terminal status, so none is lost.
 *
 * The pipeline writes `meetings.status` in-band as it runs. If the worker is
 * killed mid-job (OOM, SIGKILL, a deploy rolling the process), or the confirm
 * call that enqueues the job is lost, a meeting can be left in a NON-TERMINAL
 * status — queued / transcribing / analyzing / indexing — with durable audio in
 * R2 but NO job in the queue and no route to `failed`. The user sees a spinner
 * that never resolves and no error; and after the retention window, cleanup-r2
 * deletes the audio by age regardless of status. That is a recording silently
 * lost — the one thing a recording app must never do.
 *
 * This is the meeting-status twin of `reconcileOrphanedObjects()` in
 * cleanup-r2.ts, which already applies exactly this idea to storage. It finds
 * meetings stuck in a non-terminal status with NO live job backing them and
 * marks them `failed`, which:
 *   - surfaces the failure to the user as the retryable FailureCard, and
 *   - makes it visible to ops (this logs at error level), and
 *   - happens within minutes, long before retention treats the audio as
 *     abandoned — so a retry still has its audio.
 *
 * Runs fast and often (see the scheduler in main.ts). Doing nothing is always
 * safe: a stuck meeting simply waits for the next pass.
 */

const NON_TERMINAL = ["queued", "transcribing", "analyzing", "indexing"];

/**
 * A grace window before a non-terminal meeting is even a candidate.
 *
 * A meeting is created and its job enqueued a moment later; between those two
 * events it is non-terminal with (briefly) no visible job. The grace is
 * comfortably longer than that gap, so a healthy just-created meeting is never
 * mistaken for stuck. Age does NOT decide "stuck" on its own — the queue check
 * does — so a legitimately long transcription is safe no matter how old,
 * because its job is live.
 */
const STUCK_GRACE_MINUTES = 10;

/** Shown to the user on the FailureCard; names the cause and reassures. */
const STUCK_REASON =
  "Processing was interrupted before it finished. Your audio is safe — tap retry to run it again.";

export async function reconcileStuckMeetings(): Promise<number> {
  const sql = getSql();

  // Candidates: non-terminal for longer than the grace window. This only gates
  // out the seconds-old case; whether a candidate is actually stuck is decided
  // by the queue check below.
  const candidates = await sql<Array<{ id: string }>>`
    SELECT id FROM meetings
    WHERE status = ANY(${NON_TERMINAL})
      AND created_at < now() - make_interval(mins => ${STUCK_GRACE_MINUTES})
  `;
  if (candidates.length === 0) return 0;

  // Every meeting id that still has a job somewhere in the queue — running,
  // queued, delayed, or paused. Anything in here is being worked on (or is about
  // to be) and must NOT be failed.
  const live = new Set<string>();
  try {
    const queue = getProcessingQueue();
    const jobs = await queue.getJobs([
      "active",
      "waiting",
      "delayed",
      "paused",
      "waiting-children",
    ]);
    for (const job of jobs) {
      const id = (job?.data as ProcessingJob | undefined)?.meeting_id;
      if (id) live.add(id);
    }
  } catch (err) {
    // If the queue cannot be read, do NOTHING this pass rather than risk failing
    // a meeting that has a live job. A stuck meeting waits for the next run; a
    // wrongly-failed one is the worse outcome, and it strands audio behind a
    // retry the user did not need.
    console.error("[reconcile-stuck] could not read queue, skipping this run:", err);
    return 0;
  }

  const orphaned = candidates.map((c) => c.id).filter((id) => !live.has(id));
  if (orphaned.length === 0) return 0;

  // Idempotent by the status predicate: a concurrent reconciler on another
  // worker, or a job that completed between the SELECT and here, cannot
  // double-fail or clobber a meeting that has since reached a terminal state.
  const updated = await sql<Array<{ id: string }>>`
    UPDATE meetings
    SET status = 'failed',
        failure_reason = ${STUCK_REASON},
        retry_count = retry_count + 1
    WHERE id = ANY(${orphaned})
      AND status = ANY(${NON_TERMINAL})
    RETURNING id
  `;

  if (updated.length > 0) {
    // Error level on purpose: every row here is a job the pipeline dropped on
    // the floor, which is exactly what ops needs to see and count.
    console.error(
      `[reconcile-stuck] moved ${updated.length} interrupted meeting(s) to failed: ${updated
        .map((r) => r.id)
        .join(", ")}`,
    );
  }
  return updated.length;
}
