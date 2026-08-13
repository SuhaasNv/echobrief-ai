/**
 * Integration tests for full-text search on GET /api/v1/meetings?q=.
 *
 * Search used to match `title ILIKE '%q%'` and nothing else, so a user who
 * searched for a phrase they clearly remembered hearing got an empty list.
 * These tests pin the behaviour that replaced it: matches on transcript and
 * summary text, title outranking body, phrases, exclusions, malformed input
 * that must not 500, and — the one that matters most — that none of it ever
 * reaches across tenants.
 *
 * Fixtures are inserted straight into Postgres rather than pushed through
 * /meetings/from-transcript: that endpoint burns the hourly `upload` budget and
 * a transcription quota, and enqueues a BullMQ job no worker will pick up in
 * tests. The rows it would eventually produce are what search reads, so we
 * write those rows directly.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import api from "@/server/api";
import { hasPositiveSearchTerm } from "@/server/api/routes/meetings";
import { getSql } from "@/server/db";

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const OWNER_EMAIL = `vitest-search-a-${RUN}@test.echobrief.local`;
const OTHER_EMAIL = `vitest-search-b-${RUN}@test.echobrief.local`;

let ownerToken = "";
let ownerId = "";
let ownerWorkspaceId = "";
let otherUserId = "";

/** Meeting ids by fixture name, so assertions don't depend on titles. */
const ids: Record<string, string> = {};

async function search(query: string, token = ownerToken) {
  return api.request(`/meetings?limit=50&q=${encodeURIComponent(query)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

interface ListItem {
  id: string;
  title: string;
  match_snippet: string | null;
}

async function searchIds(query: string): Promise<string[]> {
  const res = await search(query);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { items: ListItem[] };
  return body.items.map((i) => i.id);
}

/** Insert a meeting owned by `userId` with optional transcript + summary text. */
async function seedMeeting(opts: {
  key: string;
  userId: string;
  workspaceId: string;
  title: string;
  transcript?: string;
  executive?: string;
}): Promise<string> {
  const sql = getSql();
  const id = randomUUID();
  await sql`
    INSERT INTO meetings (id, user_id, workspace_id, title, status, language)
    VALUES (${id}, ${opts.userId}, ${opts.workspaceId}, ${opts.title}, 'complete', 'en')
  `;
  if (opts.transcript !== undefined) {
    await sql`
      INSERT INTO transcripts (meeting_id, raw_text, content, speakers, language, provider)
      VALUES (${id}, ${opts.transcript}, '{}'::jsonb, '[]'::jsonb, 'en', 'user')
    `;
  }
  if (opts.executive !== undefined) {
    await sql`
      INSERT INTO summaries (meeting_id, executive) VALUES (${id}, ${opts.executive})
    `;
  }
  ids[opts.key] = id;
  return id;
}

beforeAll(async () => {
  const sql = getSql();

  const signup = await api.request("/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: OWNER_EMAIL,
      password: "testpassword12",
      name: "Search Owner",
    }),
  });
  expect(signup.status).toBe(200);
  const signupBody = (await signup.json()) as { token: string; user: { id: string } };
  ownerToken = signupBody.token;
  ownerId = signupBody.user.id;

  const [ws] = await sql<Array<{ id: string }>>`
    SELECT w.id FROM workspaces w
    JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = ${ownerId}
    ORDER BY w.created_at ASC LIMIT 1
  `;
  ownerWorkspaceId = ws.id;

  // The second tenant. No token is minted for them on purpose — the isolation
  // test only needs their data to exist and stay invisible.
  const [other] = await sql<Array<{ id: string }>>`
    INSERT INTO users (email, name, password_hash)
    VALUES (${OTHER_EMAIL}, 'Other Tenant', 'x')
    RETURNING id
  `;
  otherUserId = other.id;
  const [otherWs] = await sql<Array<{ id: string }>>`
    INSERT INTO workspaces (name, owner_id) VALUES ('Other WS', ${otherUserId}) RETURNING id
  `;
  await sql`
    INSERT INTO workspace_members (workspace_id, user_id, role)
    VALUES (${otherWs.id}, ${otherUserId}, 'admin')
  `;

  // --- Owner's meetings -------------------------------------------------
  // The word "credentials" appears ONLY in this transcript, never in a title.
  await seedMeeting({
    key: "transcriptOnly",
    userId: ownerId,
    workspaceId: ownerWorkspaceId,
    title: "Thursday sync",
    transcript:
      "We walked through the incident timeline. " +
      "Marcus said we rotated the R2 credentials right after the leak was found, " +
      "and nobody had written down where the old ones were stored. " +
      "We agreed to move everything into the secret manager before Friday.",
    executive: "The team reviewed an incident and agreed on follow-ups.",
  });

  // Title carries the term once; the transcript never mentions it.
  await seedMeeting({
    key: "titleMatch",
    userId: ownerId,
    workspaceId: ownerWorkspaceId,
    title: "Roadmap review",
    transcript:
      "We spent the hour on headcount plans and the office move. " +
      "No decisions were recorded and the room emptied early.",
  });

  // Same term, but only in the body, said over and over. Weighting must not let
  // this outrank the meeting actually NAMED for it.
  await seedMeeting({
    key: "bodyRepeats",
    userId: ownerId,
    workspaceId: ownerWorkspaceId,
    title: "Thursday standup notes",
    transcript:
      "The roadmap came up constantly. " +
      "roadmap roadmap roadmap roadmap roadmap roadmap roadmap roadmap ".repeat(5) +
      "Everyone agreed the roadmap needed another pass.",
  });

  // Only the summary mentions "procurement".
  await seedMeeting({
    key: "summaryOnly",
    userId: ownerId,
    workspaceId: ownerWorkspaceId,
    title: "Vendor call",
    transcript: "We talked about delivery windows and who signs off on what.",
    executive: "Procurement will own the vendor relationship from next quarter.",
  });

  // Phrase pair: one says "launch date" together, the other only apart.
  await seedMeeting({
    key: "phraseAdjacent",
    userId: ownerId,
    workspaceId: ownerWorkspaceId,
    title: "Planning session one",
    transcript: "We locked the launch date for the eighteenth of September.",
  });
  await seedMeeting({
    key: "phraseApart",
    userId: ownerId,
    workspaceId: ownerWorkspaceId,
    title: "Planning session two",
    transcript: "We agreed to launch once the date of the audit is confirmed.",
  });

  // Exclusion pair: both mention "hiring", only one also mentions "budget".
  await seedMeeting({
    key: "hiringOnly",
    userId: ownerId,
    workspaceId: ownerWorkspaceId,
    title: "People sync",
    transcript: "Hiring for the platform team is still open and we reviewed two candidates.",
  });
  await seedMeeting({
    key: "hiringAndBudget",
    userId: ownerId,
    workspaceId: ownerWorkspaceId,
    title: "Finance sync",
    transcript: "Hiring is paused until the budget for next year is signed off.",
  });

  // --- Other tenant's meeting -------------------------------------------
  await seedMeeting({
    key: "foreign",
    userId: otherUserId,
    workspaceId: otherWs.id,
    title: "Their credentials meeting",
    transcript:
      "We rotated the R2 credentials and discussed the roadmap and the launch date at length.",
    executive: "Procurement and credentials were the main topics.",
  });
});

afterAll(async () => {
  const sql = getSql();
  // ON DELETE CASCADE from users covers meetings, transcripts and summaries.
  await sql`DELETE FROM users WHERE email IN (${OWNER_EMAIL}, ${OTHER_EMAIL})`;
});

describe("hasPositiveSearchTerm", () => {
  it.each(["roadmap", "roadmap -budget", '"launch date"', "-budget roadmap", 'a -"cost review"'])(
    "accepts %j as having something to match on",
    (input) => {
      expect(hasPositiveSearchTerm(input)).toBe(true);
    },
  );

  it.each(["-budget", "-a -b", '-"cost review"', "-", "   ", ""])(
    "rejects %j as exclusion-only",
    (input) => {
      expect(hasPositiveSearchTerm(input)).toBe(false);
    },
  );
});

describe("GET /meetings?q= — transcript and summary matching", () => {
  it("finds a meeting by a word that appears only in its transcript", async () => {
    const found = await searchIds("credentials");
    expect(found).toContain(ids.transcriptOnly);
    // The title of that meeting is "Thursday sync" — ILIKE alone finds nothing.
    expect(found).not.toContain(ids.titleMatch);
  });

  it("finds a meeting by a phrase only its transcript contains", async () => {
    const found = await searchIds("R2 credentials");
    expect(found).toContain(ids.transcriptOnly);
  });

  it("finds a meeting by a word that appears only in its summary", async () => {
    const found = await searchIds("procurement");
    expect(found).toEqual([ids.summaryOnly]);
  });

  it("still finds a meeting by a partial word in its title", async () => {
    // Pre-existing behaviour: FTS matches whole words, so the title substring
    // branch is what keeps type-ahead working.
    const found = await searchIds("Roadm");
    expect(found).toContain(ids.titleMatch);
  });
});

describe("GET /meetings?q= — ranking", () => {
  it("ranks a title match above a transcript that repeats the term", async () => {
    const found = await searchIds("roadmap");
    expect(found).toContain(ids.titleMatch);
    expect(found).toContain(ids.bodyRepeats);
    expect(found.indexOf(ids.titleMatch)).toBeLessThan(found.indexOf(ids.bodyRepeats));
  });
});

describe("GET /meetings?q= — websearch syntax", () => {
  it("treats a quoted phrase as adjacent words", async () => {
    const found = await searchIds('"launch date"');
    expect(found).toContain(ids.phraseAdjacent);
    expect(found).not.toContain(ids.phraseApart);
  });

  it("matches both meetings when the same words are unquoted", async () => {
    const found = await searchIds("launch date");
    expect(found).toContain(ids.phraseAdjacent);
    expect(found).toContain(ids.phraseApart);
  });

  it("honours a -exclusion term", async () => {
    const all = await searchIds("hiring");
    expect(all).toContain(ids.hiringOnly);
    expect(all).toContain(ids.hiringAndBudget);

    const filtered = await searchIds("hiring -budget");
    expect(filtered).toContain(ids.hiringOnly);
    expect(filtered).not.toContain(ids.hiringAndBudget);
  });

  it.each([
    "foo & | bar",
    "!!!",
    ":*",
    "'",
    '"unterminated',
    "&&&|||",
    "-",
    "   ",
    "a & !b <-> c",
    "\\",
    "%_%",
  ])("does not 500 on malformed query %j", async (bad) => {
    const res = await search(bad);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: ListItem[]; total: number };
    expect(Array.isArray(body.items)).toBe(true);
    expect(typeof body.total).toBe("number");
  });

  it("rejects a query longer than the schema allows", async () => {
    const res = await search("x".repeat(201));
    expect(res.status).toBe(400);
  });
});

describe("GET /meetings?q= — match snippet", () => {
  it("returns an excerpt showing why a transcript matched", async () => {
    const res = await search("credentials");
    const body = (await res.json()) as { items: ListItem[] };
    const hit = body.items.find((i) => i.id === ids.transcriptOnly);
    expect(hit).toBeDefined();
    expect(hit?.match_snippet).toBeTruthy();
    expect(hit?.match_snippet).toContain("[[credentials]]");
    expect(hit?.match_snippet?.length).toBeLessThanOrEqual(240);
  });

  it("returns a null snippet when there is no query", async () => {
    const res = await api.request("/meetings?limit=5", {
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: ListItem[] };
    expect(body.items.length).toBeGreaterThan(0);
    for (const item of body.items) expect(item.match_snippet).toBeNull();
  });
});

describe("GET /meetings?q= — tenant isolation", () => {
  it.each(["credentials", "roadmap", '"launch date"', "procurement", "R2"])(
    "never returns another user's meeting for %j",
    async (term) => {
      const found = await searchIds(term);
      expect(found).not.toContain(ids.foreign);
    },
  );

  it("keeps search scoped when the other tenant owns the only match", async () => {
    const sql = getSql();
    // A word that exists nowhere in the owner's fixtures.
    await sql`
      UPDATE transcripts SET raw_text = raw_text || ' The kestrel deployment was postponed.'
      WHERE meeting_id = ${ids.foreign}
    `;
    const found = await searchIds("kestrel");
    expect(found).toEqual([]);
  });
});

describe("GET /meetings — pagination contract", () => {
  it("keeps the page shape and honours limit/offset while searching", async () => {
    const res = await api.request("/meetings?q=hiring&page=1&limit=1", {
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: ListItem[];
      total: number;
      page: number;
      limit: number;
    };
    expect(body.page).toBe(1);
    expect(body.limit).toBe(1);
    expect(body.items).toHaveLength(1);
    // total counts every match, not just this page.
    expect(body.total).toBe(2);

    const page2 = await api.request("/meetings?q=hiring&page=2&limit=1", {
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const body2 = (await page2.json()) as { items: ListItem[]; total: number };
    expect(body2.items).toHaveLength(1);
    expect(body2.total).toBe(2);
    expect(body2.items[0].id).not.toBe(body.items[0].id);
  });

  it("still returns unfiltered meetings in recency order", async () => {
    const res = await api.request("/meetings?limit=50", {
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ id: string; created_at: string }>;
      total: number;
    };
    expect(body.total).toBe(8);
    const times = body.items.map((i) => new Date(i.created_at).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("requires authentication", async () => {
    const res = await api.request("/meetings?q=credentials");
    expect(res.status).toBe(401);
  });
});
