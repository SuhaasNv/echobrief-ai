/**
 * Integration tests for /api/v1/account/preferences.
 *
 * These exist for one reason: this codebase has already shipped settings that
 * rendered as chosen and were read by nothing. A unit test on the AssemblyAI
 * request proves the last hop; this proves the first ones — that the field
 * survives the request schema, reaches a real column, comes back on the next
 * read, and is visible to the exact SELECT the processing worker runs.
 *
 * `filter_profanity` is the subject because it is the newest, but the
 * unrelated-field cases below guard the whole upsert: it is a single INSERT ..
 * ON CONFLICT with a dynamically built SET list, and the way that breaks is by
 * quietly resetting a column nobody mentioned.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import api from "@/server/api";
import { getSql } from "@/server/db";
import type { UserPreferencesRow } from "@/server/db/types";

const TEST_PREFIX = `vitest-prefs-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
let userEmail = "";
let userToken = "";

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

async function patchJson(path: string, body: unknown, token: string) {
  return api.request(path, {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

async function get(path: string, token: string) {
  return api.request(path, { headers: { authorization: `Bearer ${token}` } });
}

beforeAll(async () => {
  userEmail = `${TEST_PREFIX}@test.echobrief.local`;
  const signup = await postJson("/auth/signup", {
    email: userEmail,
    password: "testpassword12",
    name: "Preferences Test",
  });
  expect(signup.status).toBe(200);
  const body = await signup.json();
  userToken = body.token;
});

afterAll(async () => {
  const sql = getSql();
  if (userEmail) await sql`DELETE FROM users WHERE email = ${userEmail}`;
});

describe("GET /account/preferences", () => {
  it("reports profanity filtering off for an account that has never saved one", async () => {
    const res = await get("/account/preferences", userToken);
    expect(res.status).toBe(200);

    const body = await res.json();
    // Not merely falsy — the field has to be PRESENT, because the mobile client
    // seeds its switch from it unconditionally and `undefined` would render the
    // same as `false` while meaning something else entirely.
    expect(body).toHaveProperty("filter_profanity");
    expect(body.filter_profanity).toBe(false);
  });
});

describe("PATCH /account/preferences", () => {
  it("stores filter_profanity and returns the merged row", async () => {
    const res = await patchJson("/account/preferences", { filter_profanity: true }, userToken);
    expect(res.status).toBe(200);
    expect((await res.json()).filter_profanity).toBe(true);

    const after = await get("/account/preferences", userToken);
    expect((await after.json()).filter_profanity).toBe(true);
  });

  it("is visible to the SELECT the processing worker runs", async () => {
    const sql = getSql();
    // Deliberately the worker's own projection, not SELECT *: if someone drops
    // the column from that list the setting goes inert again and this fails.
    const rows = await sql<
      Array<Pick<UserPreferencesRow, "transcription_language" | "vocabulary" | "filter_profanity">>
    >`
      SELECT up.transcription_language, up.vocabulary, up.filter_profanity
      FROM user_preferences up
      JOIN users u ON u.id = up.user_id
      WHERE u.email = ${userEmail}
    `;

    expect(rows).toHaveLength(1);
    expect(rows[0].filter_profanity).toBe(true);
  });

  it("leaves it alone when an unrelated preference is saved", async () => {
    const res = await patchJson("/account/preferences", { vocabulary: ["EchoBrief"] }, userToken);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.vocabulary).toEqual(["EchoBrief"]);
    // The upsert builds its SET list from the fields present in the patch. A
    // vocabulary save must not be what silently starts — or stops — censoring
    // someone's transcripts.
    expect(body.filter_profanity).toBe(true);
  });

  it("turns it back off, so the control is not one-way", async () => {
    const res = await patchJson("/account/preferences", { filter_profanity: false }, userToken);
    expect(res.status).toBe(200);
    expect((await res.json()).filter_profanity).toBe(false);

    const after = await get("/account/preferences", userToken);
    expect((await after.json()).filter_profanity).toBe(false);
  });

  it("rejects a non-boolean rather than coercing it", async () => {
    const res = await patchJson("/account/preferences", { filter_profanity: "yes" }, userToken);
    expect(res.status).toBe(400);
  });
});
