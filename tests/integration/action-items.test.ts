/**
 * Integration tests for /api/v1/action-items — completion timestamps.
 *
 * The behaviour under test is the transition, not the boolean: completed_at is
 * stamped when an item goes false -> true, cleared when it goes back, and left
 * ALONE when an already-complete item is completed again. That last one is the
 * one worth a test — clients re-send `completed: true` on optimistic retries
 * and refreshes, and a naive `completed_at = now()` silently rewrites the day
 * the user finished the task every single time.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import api from "@/server/api";
import { getSql } from "@/server/db";

const TEST_PREFIX = `vitest-ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
let userEmail = "";
let userToken = "";
let meetingId = "";

/** Second user, to prove the tenant scoping on PATCH still holds. */
let otherEmail = "";
let otherToken = "";

interface ActionItemPayload {
  id: string;
  description: string;
  due_date: string | null;
  completed: boolean;
  completed_at: string | null;
  meeting_title?: string;
  meeting_date?: string | null;
  created_at: string;
}

async function postJson(path: string, body: unknown, token?: string) {
  return api.request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function patchJson(path: string, body: unknown, token?: string) {
  return api.request(path, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function get(path: string, token?: string) {
  return api.request(path, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
}

/** Action items are created by the summarisation worker, so seed them directly. */
async function seedItem(opts: {
  description: string;
  due_date?: string | null;
  completed?: boolean;
  completed_at?: string | null;
}): Promise<string> {
  const sql = getSql();
  const rows = await sql<Array<{ id: string }>>`
    INSERT INTO action_items (meeting_id, user_id, workspace_id, description, due_date, completed, completed_at)
    SELECT id, user_id, workspace_id, ${opts.description}, ${opts.due_date ?? null},
           ${opts.completed ?? false}, ${opts.completed_at ?? null}
    FROM meetings WHERE id = ${meetingId}
    RETURNING id
  `;
  return rows[0].id;
}

async function readItem(id: string): Promise<{ completed: boolean; completed_at: Date | null }> {
  const sql = getSql();
  const rows = await sql<Array<{ completed: boolean; completed_at: Date | null }>>`
    SELECT completed, completed_at FROM action_items WHERE id = ${id}
  `;
  return rows[0];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeAll(async () => {
  userEmail = `${TEST_PREFIX}@test.echobrief.local`;
  const signup = await postJson("/auth/signup", {
    email: userEmail,
    password: "testpassword12",
    name: "Action Item Test",
  });
  expect(signup.status).toBe(200);
  userToken = (await signup.json()).token;

  otherEmail = `${TEST_PREFIX}-other@test.echobrief.local`;
  const otherSignup = await postJson("/auth/signup", {
    email: otherEmail,
    password: "testpassword12",
    name: "Other Tenant",
  });
  expect(otherSignup.status).toBe(200);
  otherToken = (await otherSignup.json()).token;

  const meeting = await postJson(
    "/meetings/from-transcript",
    {
      title: `Vitest action items ${Date.now()}`,
      transcript_text:
        "Speaker 1: Ship the migration this week. Speaker 2: I'll take the rollback script.",
      language: "en",
    },
    userToken,
  );
  expect(meeting.status).toBe(200);
  meetingId = (await meeting.json()).meeting_id;
});

afterAll(async () => {
  const sql = getSql();
  if (userEmail) await sql`DELETE FROM users WHERE email = ${userEmail}`;
  if (otherEmail) await sql`DELETE FROM users WHERE email = ${otherEmail}`;
});

describe("PATCH /action-items/:id — completion timestamp", () => {
  it("stamps completed_at when completed flips false -> true", async () => {
    const id = await seedItem({ description: "Flip to complete" });

    const before = await readItem(id);
    expect(before.completed).toBe(false);
    expect(before.completed_at).toBeNull();

    const res = await patchJson(`/action-items/${id}`, { completed: true }, userToken);
    expect(res.status).toBe(200);

    // The timestamp is part of the response, not something the client has to
    // refetch to learn.
    const body = await res.json();
    expect(body.item.completed).toBe(true);
    expect(body.item.completed_at).not.toBeNull();

    const after = await readItem(id);
    expect(after.completed).toBe(true);
    expect(after.completed_at).toBeInstanceOf(Date);
  });

  it("clears completed_at when completed flips true -> false", async () => {
    const id = await seedItem({ description: "Flip back to open" });

    await patchJson(`/action-items/${id}`, { completed: true }, userToken);
    expect((await readItem(id)).completed_at).not.toBeNull();

    const res = await patchJson(`/action-items/${id}`, { completed: false }, userToken);
    expect(res.status).toBe(200);
    expect((await res.json()).item.completed_at).toBeNull();

    const after = await readItem(id);
    expect(after.completed).toBe(false);
    expect(after.completed_at).toBeNull();
  });

  it("does NOT bump completed_at when an already-complete item is re-completed", async () => {
    const id = await seedItem({ description: "Re-complete is idempotent" });

    await patchJson(`/action-items/${id}`, { completed: true }, userToken);
    const first = await readItem(id);
    expect(first.completed_at).toBeInstanceOf(Date);

    // Long enough that now() would differ well beyond clock resolution, so an
    // unchanged value cannot be a coincidence.
    await sleep(1100);

    const res = await patchJson(`/action-items/${id}`, { completed: true }, userToken);
    expect(res.status).toBe(200);

    const second = await readItem(id);
    expect(second.completed).toBe(true);
    expect(second.completed_at?.getTime()).toBe(first.completed_at?.getTime());
  });

  it("re-completing does not resurrect a NULL completed_at from the backfill", async () => {
    // A row completed before the API recorded timestamps: completed, no date.
    // Re-completing it must not invent one.
    const id = await seedItem({
      description: "Completed long ago, date unknown",
      completed: true,
      completed_at: null,
    });

    const res = await patchJson(`/action-items/${id}`, { completed: true }, userToken);
    expect(res.status).toBe(200);
    expect((await res.json()).item.completed_at).toBeNull();
    expect((await readItem(id)).completed_at).toBeNull();
  });

  it("leaves completed_at alone when the patch does not touch `completed`", async () => {
    const id = await seedItem({ description: "Rename only" });
    await patchJson(`/action-items/${id}`, { completed: true }, userToken);
    const before = await readItem(id);

    await sleep(1100);
    const res = await patchJson(`/action-items/${id}`, { description: "Renamed" }, userToken);
    expect(res.status).toBe(200);

    const after = await readItem(id);
    expect(after.completed_at?.getTime()).toBe(before.completed_at?.getTime());
  });

  it("does not let another tenant complete someone else's item", async () => {
    const id = await seedItem({ description: "Cross-tenant target" });

    const res = await patchJson(`/action-items/${id}`, { completed: true }, otherToken);
    expect(res.status).toBe(404);

    // The point of the test: the row is untouched, not merely the response.
    const after = await readItem(id);
    expect(after.completed).toBe(false);
    expect(after.completed_at).toBeNull();
  });
});

describe("GET /action-items", () => {
  it("returns completed_at and the source meeting's date on each item", async () => {
    const id = await seedItem({ description: "Payload shape" });
    await patchJson(`/action-items/${id}`, { completed: true }, userToken);

    const res = await get("/action-items", userToken);
    expect(res.status).toBe(200);
    const body = await res.json();

    // `{ items: [...] }`, never a bare array.
    expect(Array.isArray(body.items)).toBe(true);

    const item = body.items.find((i: ActionItemPayload) => i.id === id);
    expect(item).toBeDefined();
    expect(item.completed_at).not.toBeNull();
    expect(Number.isNaN(Date.parse(item.completed_at))).toBe(false);
    // Captured-on date, so the Open list can say which meeting this came from.
    expect(item.meeting_date).toBeTruthy();
    expect(item.meeting_title).toBeTruthy();
  });

  it("orders the Done list most-recently-completed first, undated rows last", async () => {
    const older = await seedItem({ description: "Completed first" });
    await patchJson(`/action-items/${older}`, { completed: true }, userToken);
    await sleep(1100);
    const newer = await seedItem({ description: "Completed second" });
    await patchJson(`/action-items/${newer}`, { completed: true }, userToken);

    const undated = await seedItem({
      description: "Completed, date unknown",
      completed: true,
      completed_at: null,
    });

    const res = await get("/action-items?completed=true", userToken);
    expect(res.status).toBe(200);
    const items: ActionItemPayload[] = (await res.json()).items;

    const order = items.map((i) => i.id);
    expect(order.indexOf(newer)).toBeLessThan(order.indexOf(older));

    // NULLS LAST: rows with no recorded completion sink below every dated row,
    // where the clients render them under "Completed earlier". Asserted as a
    // partition rather than "undated is last" — other tests in this file seed
    // undated rows too, and they share the tail.
    const firstUndated = items.findIndex((i) => i.completed_at === null);
    expect(firstUndated).toBeGreaterThan(-1);
    expect(items.slice(firstUndated).every((i) => i.completed_at === null)).toBe(true);
    expect(order.indexOf(undated)).toBeGreaterThanOrEqual(firstUndated);
    expect(order.indexOf(undated)).toBeGreaterThan(order.indexOf(older));

    expect(items.every((i) => i.completed)).toBe(true);
  });
});
