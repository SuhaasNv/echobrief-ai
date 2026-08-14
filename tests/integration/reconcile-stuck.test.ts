/**
 * The stuck-meeting reconciler must never lose a recording, and never fail a
 * meeting that is genuinely still processing.
 *
 * These are the two ways this can go wrong, and both are covered: a job the
 * pipeline dropped must become a retryable `failed` (so its audio is not
 * silently deleted by retention while the user stares at a dead spinner), and a
 * long-running job that still has a live queue entry must be left alone (failing
 * it would strand the audio behind a retry the user never needed).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getSql } from "@/server/db";
import { getProcessingQueue } from "@/server/services/queue";
import { reconcileStuckMeetings } from "@/server/workers/reconcile-stuck";

const PREFIX = `vitest-reconcile-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
let userId: string;
let workspaceId: string;
const meetingIds: string[] = [];

/** Insert a meeting with a controlled status and age, bypassing the API. */
async function seedMeeting(status: string, ageMinutes: number): Promise<string> {
  const sql = getSql();
  const [row] = await sql<Array<{ id: string }>>`
    INSERT INTO meetings (user_id, workspace_id, title, status, created_at)
    VALUES (
      ${userId}, ${workspaceId}, ${`${PREFIX}-${status}-${ageMinutes}`}, ${status},
      now() - make_interval(mins => ${ageMinutes})
    )
    RETURNING id
  `;
  meetingIds.push(row.id);
  return row.id;
}

async function statusOf(id: string): Promise<{ status: string; failure_reason: string | null }> {
  const sql = getSql();
  const [row] = await sql<Array<{ status: string; failure_reason: string | null }>>`
    SELECT status, failure_reason FROM meetings WHERE id = ${id}
  `;
  return row;
}

beforeAll(async () => {
  const sql = getSql();
  const [u] = await sql<Array<{ id: string }>>`
    INSERT INTO users (email, name) VALUES (${`${PREFIX}@test.echobrief.local`}, 'Reconcile Test')
    RETURNING id
  `;
  userId = u.id;
  const [w] = await sql<Array<{ id: string }>>`
    INSERT INTO workspaces (owner_id, name) VALUES (${userId}, 'Reconcile WS')
    RETURNING id
  `;
  workspaceId = w.id;
});

afterAll(async () => {
  const sql = getSql();
  if (meetingIds.length) await sql`DELETE FROM meetings WHERE id = ANY(${meetingIds})`;
  if (userId) await sql`DELETE FROM users WHERE id = ${userId}`;
});

describe("reconcileStuckMeetings", () => {
  it("fails a meeting stuck non-terminal past the grace window with no job", async () => {
    const stuck = await seedMeeting("transcribing", 30);

    await reconcileStuckMeetings();

    const after = await statusOf(stuck);
    expect(after.status).toBe("failed");
    // The user-facing reason must reassure that the audio is safe, not read as a
    // generic error — the whole point is that the recording is NOT lost.
    expect(after.failure_reason).toMatch(/audio is safe/i);
  });

  it("fails every non-terminal status, but leaves terminal ones untouched", async () => {
    const stuckQueued = await seedMeeting("queued", 30);
    const stuckAnalyzing = await seedMeeting("analyzing", 30);
    const stuckIndexing = await seedMeeting("indexing", 30);
    const complete = await seedMeeting("complete", 30);
    const alreadyFailed = await seedMeeting("failed", 30);

    await reconcileStuckMeetings();

    expect((await statusOf(stuckQueued)).status).toBe("failed");
    expect((await statusOf(stuckAnalyzing)).status).toBe("failed");
    expect((await statusOf(stuckIndexing)).status).toBe("failed");
    // Terminal states are never rewritten — a completed meeting must not be
    // dragged back to failed, and a failed one must not have its retry_count
    // pumped on every pass.
    expect((await statusOf(complete)).status).toBe("complete");
    expect((await statusOf(alreadyFailed)).status).toBe("failed");
  });

  it("spares a recently-created meeting inside the grace window", async () => {
    // 2 minutes old: its job may simply not have been picked up yet.
    const fresh = await seedMeeting("queued", 2);

    await reconcileStuckMeetings();

    expect((await statusOf(fresh)).status).toBe("queued");
  });

  it("spares a stuck-looking meeting that still has a live job in the queue", async () => {
    const withJob = await seedMeeting("transcribing", 30);

    const queue = getProcessingQueue();
    // A real queue entry for this meeting — this is what makes it "still being
    // worked on" rather than abandoned. Delayed far out so no worker in the test
    // env picks it up and completes it mid-assertion.
    const job = await queue.add(
      "process",
      { meeting_id: withJob, user_id: userId, audio_key: "test/key.m4a", language: "en" },
      { delay: 10 * 60 * 1000 },
    );

    try {
      await reconcileStuckMeetings();
      // Untouched: the reconciler saw a live job and left it alone.
      expect((await statusOf(withJob)).status).toBe("transcribing");
    } finally {
      await job.remove();
    }
  });
});
