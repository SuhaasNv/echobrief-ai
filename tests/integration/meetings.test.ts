/**
 * Integration tests for /api/v1/meetings (transcript-upload path + CRUD).
 *
 * We avoid the audio-upload flow here because it would burn an AssemblyAI
 * job; the transcript-upload path exercises the same end-to-end DB layout
 * without spending external API credits.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import api from "@/server/api";
import { getSql } from "@/server/db";

const TEST_PREFIX = `vitest-mtg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
let userEmail = "";
let userToken = "";
const createdMeetingIds: string[] = [];

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

async function get(path: string, token?: string) {
  return api.request(path, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
}

beforeAll(async () => {
  userEmail = `${TEST_PREFIX}@test.echobrief.local`;
  const signup = await postJson("/auth/signup", {
    email: userEmail,
    password: "testpassword12",
    name: "Meeting Test",
  });
  expect(signup.status).toBe(200);
  const body = await signup.json();
  userToken = body.token;
});

afterAll(async () => {
  // ON DELETE CASCADE on meetings table covers transcripts/chunks/action_items.
  // Deleting the user takes care of everything they own.
  const sql = getSql();
  if (userEmail) await sql`DELETE FROM users WHERE email = ${userEmail}`;
});

describe("POST /meetings/from-transcript", () => {
  it("creates a meeting + transcript row + queues a job", async () => {
    const body = {
      title: `Vitest transcript ${Date.now()}`,
      transcript_text:
        "Speaker 1: We need to align on the launch date. " +
        "Speaker 2: I propose September eighteenth. " +
        "Speaker 1: Let's go with that. Engineering will own the rollout doc.",
      language: "en",
      tags: ["vitest"],
    };
    const res = await postJson("/meetings/from-transcript", body, userToken);
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.meeting_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(out.status).toBe("queued");
    createdMeetingIds.push(out.meeting_id);

    // Verify rows landed in Postgres
    const sql = getSql();
    const meetings = await sql<Array<{ id: string; title: string; audio_key: string | null }>>`
      SELECT id, title, audio_key FROM meetings WHERE id = ${out.meeting_id}
    `;
    expect(meetings).toHaveLength(1);
    expect(meetings[0].title).toBe(body.title);
    expect(meetings[0].audio_key).toBeNull();

    const transcripts = await sql`
      SELECT raw_text, provider FROM transcripts WHERE meeting_id = ${out.meeting_id}
    `;
    expect(transcripts).toHaveLength(1);
    expect(transcripts[0].provider).toBe("user");
    expect(transcripts[0].raw_text).toBe(body.transcript_text);
  });

  it("rejects transcript shorter than 50 chars", async () => {
    const res = await postJson(
      "/meetings/from-transcript",
      { title: "Too short", transcript_text: "hi" },
      userToken,
    );
    expect(res.status).toBe(400);
  });

  it("requires authentication", async () => {
    const res = await postJson("/meetings/from-transcript", {
      title: "No auth",
      transcript_text: "x".repeat(100),
    });
    expect(res.status).toBe(401);
  });
});

describe("GET /meetings", () => {
  it("returns only the authed user's meetings", async () => {
    const res = await get("/meetings?limit=50", userToken);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.items)).toBe(true);
    // All meetings we created in this suite should be in the list
    for (const id of createdMeetingIds) {
      expect(body.items.some((m: { id: string }) => m.id === id)).toBe(true);
    }
  });
});

describe("DELETE /meetings/:id", () => {
  it("cascades and removes the meeting + transcript", async () => {
    // Create a fresh meeting just for this test
    const created = await postJson(
      "/meetings/from-transcript",
      {
        title: "Vitest delete-me",
        transcript_text: "x ".repeat(40),
        language: "en",
        tags: [],
      },
      userToken,
    );
    const { meeting_id } = await created.json();

    const del = await api.request(`/meetings/${meeting_id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(del.status).toBe(200);

    // Verify it's gone from DB
    const sql = getSql();
    const rows = await sql`SELECT id FROM meetings WHERE id = ${meeting_id}`;
    expect(rows).toHaveLength(0);
    const transcripts = await sql`SELECT id FROM transcripts WHERE meeting_id = ${meeting_id}`;
    expect(transcripts).toHaveLength(0);
  });
});
