/**
 * Security regression tests.
 *
 * Every case here corresponds to a hole that was open in the API and is now
 * closed. They are written from the attacker's side: sign in as user B and try
 * to touch user A's data, rather than asserting that user A can touch their own.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import api from "@/server/api";
import { getSql } from "@/server/db";
import { getRedis } from "@/server/services/redis";
import { clientIp } from "@/server/api/middleware/rate-limit";
import type { AppBindings } from "@/server/api/types";

const TEST_PREFIX = `vitest-sec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const createdEmails: string[] = [];

interface TestUser {
  id: string;
  email: string;
  token: string;
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

async function createUser(label: string): Promise<TestUser> {
  const email = `${TEST_PREFIX}-${label}@test.echobrief.local`;
  createdEmails.push(email);
  const res = await postJson("/auth/signup", {
    email,
    password: "testpassword12",
    name: `Sec ${label}`,
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  return { id: body.user.id, email, token: body.token };
}

async function createMeeting(token: string, title: string): Promise<string> {
  const res = await postJson(
    "/meetings/from-transcript",
    {
      title,
      transcript_text:
        "Speaker 1: This transcript exists only so the meeting row is valid. " +
        "Speaker 2: Agreed, it needs to clear the fifty character minimum.",
      language: "en",
      tags: [],
    },
    token,
  );
  expect(res.status).toBe(200);
  const body = await res.json();
  return body.meeting_id;
}

let victim: TestUser;
let attacker: TestUser;

beforeAll(async () => {
  // Warm the pooled Postgres client while NODE_ENV is still "test": one test
  // below flips NODE_ENV to exercise the real limiter, and getSql() reads
  // NODE_ENV to decide whether to demand SSL.
  getSql();
  victim = await createUser("victim");
  attacker = await createUser("attacker");
});

afterAll(async () => {
  const sql = getSql();
  if (createdEmails.length > 0) {
    await sql`DELETE FROM users WHERE email = ANY(${sql.array(createdEmails)})`;
  }
});

// ---------------------------------------------------------------------------
// IDOR — object ownership must be part of the query, not a later check
// ---------------------------------------------------------------------------
describe("IDOR: cross-user meeting access", () => {
  let victimMeetingId = "";

  beforeAll(async () => {
    victimMeetingId = await createMeeting(victim.token, "Victim private meeting");
  });

  it("does not expose another user's meeting on GET /meetings/:id", async () => {
    const res = await get(`/meetings/${victimMeetingId}`, attacker.token);
    expect(res.status).toBe(404);
  });

  it("does not leak another user's meeting in the list", async () => {
    const res = await get("/meetings?limit=100", attacker.token);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.some((m: { id: string }) => m.id === victimMeetingId)).toBe(false);
  });

  it("cannot rename another user's meeting", async () => {
    const res = await patchJson(`/meetings/${victimMeetingId}`, { title: "pwned" }, attacker.token);
    // The UPDATE carries the ownership predicate, so it matches zero rows.
    expect([200, 404]).toContain(res.status);

    const sql = getSql();
    const [row] = await sql<[{ title: string }]>`
      SELECT title FROM meetings WHERE id = ${victimMeetingId}
    `;
    expect(row.title).toBe("Victim private meeting");
  });

  it("cannot delete another user's meeting", async () => {
    const res = await api.request(`/meetings/${victimMeetingId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${attacker.token}` },
    });
    expect(res.status).toBe(404);

    const sql = getSql();
    const rows = await sql`SELECT id FROM meetings WHERE id = ${victimMeetingId}`;
    expect(rows).toHaveLength(1);
  });

  it("cannot rename speakers on another user's transcript", async () => {
    const res = await patchJson(
      `/meetings/${victimMeetingId}/speakers`,
      { names: { A: "Injected" } },
      attacker.token,
    );
    expect(res.status).toBe(404);
  });

  it("cannot mint a share link for another user's meeting", async () => {
    const res = await postJson(
      `/meetings/${victimMeetingId}/share`,
      { enabled: true },
      attacker.token,
    );
    expect(res.status).toBe(404);

    const sql = getSql();
    const [row] = await sql<[{ share_token: string | null }]>`
      SELECT share_token FROM meetings WHERE id = ${victimMeetingId}
    `;
    expect(row.share_token).toBeNull();
  });

  it("cannot generate an email from another user's meeting", async () => {
    const res = await postJson(
      "/generate/email",
      { meeting_id: victimMeetingId, type: "meeting_recap", tone: "professional" },
      attacker.token,
    );
    // 403 if the attacker's workspace isn't professional, 404 once it is —
    // either way the meeting is never read.
    expect([403, 404]).toContain(res.status);
  });
});

// ---------------------------------------------------------------------------
// IDOR — client-supplied R2 object key
// ---------------------------------------------------------------------------
describe("IDOR: client-supplied audio_key on POST /meetings/from-live", () => {
  const liveBody = (audioKey: string) => ({
    title: "Live capture",
    transcript_text: "Speaker 1: this is a live recording transcript.",
    audio_key: audioKey,
    audio_size: 1024,
    audio_mime: "audio/webm",
    duration_sec: 30,
    language: "en",
    tags: [],
  });

  it("rejects an audio_key under another user's prefix", async () => {
    const stolenKey = `${victim.id}/00000000-0000-0000-0000-000000000000/original.webm`;
    const res = await postJson("/meetings/from-live", liveBody(stolenKey), attacker.token);
    expect(res.status).toBe(403);

    // And nothing was persisted that could later be signed or deleted.
    const sql = getSql();
    const rows = await sql`SELECT id FROM meetings WHERE audio_key = ${stolenKey}`;
    expect(rows).toHaveLength(0);
  });

  it("rejects a traversal-shaped audio_key", async () => {
    const res = await postJson(
      "/meetings/from-live",
      liveBody(`${attacker.id}/../${victim.id}/x/original.webm`),
      attacker.token,
    );
    expect(res.status).toBe(403);
  });

  it("accepts an audio_key under the caller's own prefix", async () => {
    const ownKey = `${attacker.id}/11111111-1111-1111-1111-111111111111/original.webm`;
    const res = await postJson("/meetings/from-live", liveBody(ownKey), attacker.token);
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Public share token
// ---------------------------------------------------------------------------
describe("public share token", () => {
  let meetingId = "";
  let shareToken = "";

  beforeAll(async () => {
    meetingId = await createMeeting(victim.token, "Shared meeting");
    const res = await postJson(`/meetings/${meetingId}/share`, { enabled: true }, victim.token);
    expect(res.status).toBe(200);
    shareToken = (await res.json()).share_token;
  });

  it("issues a high-entropy hex token", () => {
    expect(shareToken).toMatch(/^[a-f0-9]{32}$/);
  });

  it("serves the meeting without auth but leaks nothing about the owner", async () => {
    const res = await get(`/share/${shareToken}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe("Shared meeting");

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(victim.email);
    expect(serialized).not.toContain(victim.id);
    expect(body).not.toHaveProperty("user_id");
    expect(body).not.toHaveProperty("workspace_id");
    expect(body).not.toHaveProperty("audio_key");
    expect(body).not.toHaveProperty("share_token");
  });

  it("404s on a well-formed token that does not exist (no enumeration signal)", async () => {
    const res = await get(`/share/${"a".repeat(32)}`);
    expect(res.status).toBe(404);
  });

  it("400s on a malformed token before touching the database", async () => {
    const res = await get("/share/not-a-hex-token");
    expect(res.status).toBe(400);
  });

  it("revocation actually revokes", async () => {
    const off = await postJson(`/meetings/${meetingId}/share`, { enabled: false }, victim.token);
    expect(off.status).toBe(200);

    const res = await get(`/share/${shareToken}`);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Session lifetime
// ---------------------------------------------------------------------------
describe("password change revokes outstanding tokens", () => {
  it("kills the old bearer token and hands back a working replacement", async () => {
    const user = await createUser("rotate");
    const oldToken = user.token;

    // Sanity: the token works before the change.
    expect((await get("/account/me", oldToken)).status).toBe(200);

    const res = await postJson(
      "/account/password",
      { current_password: "testpassword12", new_password: "brand-new-password-9" },
      oldToken,
    );
    expect(res.status).toBe(200);
    const { token: freshToken } = await res.json();
    expect(freshToken).toBeTypeOf("string");

    // The token an attacker would still be holding is now dead...
    const replayed = await get("/account/me", oldToken);
    expect(replayed.status).toBe(401);

    // ...while the caller stays signed in with the replacement.
    expect((await get("/account/me", freshToken)).status).toBe(200);
  });

  it("rejects a wrong current_password without changing anything", async () => {
    const user = await createUser("rotate-fail");
    const res = await postJson(
      "/account/password",
      { current_password: "not-the-password", new_password: "brand-new-password-9" },
      user.token,
    );
    expect(res.status).toBe(401);
    expect((await get("/account/me", user.token)).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------
describe("rate limiter", () => {
  it("derives the client IP from the trusted proxy hop, not the client's own header", async () => {
    const app = new Hono<AppBindings>();
    app.get("/ip", (c) => c.json({ ip: clientIp(c) }));

    // One trusted hop (Railway's edge): the LAST entry is what our edge saw.
    // Reading the first entry would let any caller mint a fresh bucket per
    // request with `X-Forwarded-For: <random>`.
    const spoofed = await app.request("/ip", {
      headers: { "x-forwarded-for": "1.2.3.4, 203.0.113.9" },
    });
    expect((await spoofed.json()).ip).toBe("203.0.113.9");

    // cf-connecting-ip is pure client input unless we are actually behind
    // Cloudflare, so it must not win by default.
    const cf = await app.request("/ip", {
      headers: { "cf-connecting-ip": "6.6.6.6", "x-forwarded-for": "203.0.113.9" },
    });
    expect((await cf.json()).ip).not.toBe("6.6.6.6");
  });

  it("is bypassed in the test environment, and only because NODE_ENV says so", async () => {
    expect(process.env.NODE_ENV).toBe("test");
    // 10 rapid public requests would blow the auth_ip budget if the bypass were
    // keyed on anything else (or absent).
    for (let i = 0; i < 10; i++) {
      const res = await postJson("/auth/login", {
        email: `nobody-${i}@example.invalid`,
        password: "whatever12",
      });
      expect(res.status).toBe(401);
    }
  });

  it("enforces the share bucket on the public endpoint when not in test mode", async () => {
    const redis = getRedis();
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const token = "b".repeat(32);
      let sawRateLimit = false;
      // share bucket is 60/min/IP; every request here shares the same key.
      for (let i = 0; i < 70; i++) {
        const res = await get(`/share/${token}`);
        if (res.status === 429) {
          sawRateLimit = true;
          expect(res.headers.get("retry-after")).toBeTruthy();
          break;
        }
        expect(res.status).toBe(404);
      }
      expect(sawRateLimit).toBe(true);
    } finally {
      process.env.NODE_ENV = original;
      // Leave no counters behind for the next file.
      const keys = await redis.keys("ratelimit:*");
      if (keys.length > 0) await redis.del(...keys);
    }
  });

  it("fails CLOSED on the public auth surface when the counter is unreachable", async () => {
    const redis = getRedis();
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    // Simulate a Redis outage for the duration of one request.
    const realIncr = redis.incr.bind(redis);
    const brokenIncr = (() => Promise.reject(new Error("redis down"))) as typeof redis.incr;
    redis.incr = brokenIncr;
    try {
      const res = await postJson("/auth/login", {
        email: "someone@example.invalid",
        password: "whatever12",
      });
      // 503, never a 200/401 — an unmetered login endpoint during an outage is
      // a credential-stuffing window.
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toBe("rate_limiter_unavailable");
    } finally {
      redis.incr = realIncr;
      process.env.NODE_ENV = original;
      const keys = await redis.keys("ratelimit:*");
      if (keys.length > 0) await redis.del(...keys);
    }
  });
});

// ---------------------------------------------------------------------------
// Workspace scoping
// ---------------------------------------------------------------------------
describe("workspace header cannot be forged", () => {
  it("rejects an X-Workspace-Id the caller is not a member of", async () => {
    const sql = getSql();
    const [victimWorkspace] = await sql<[{ id: string }]>`
      SELECT id FROM workspaces WHERE owner_id = ${victim.id} LIMIT 1
    `;

    const res = await api.request("/meetings", {
      headers: {
        authorization: `Bearer ${attacker.token}`,
        "x-workspace-id": victimWorkspace.id,
      },
    });
    expect(res.status).toBe(403);
  });
});
