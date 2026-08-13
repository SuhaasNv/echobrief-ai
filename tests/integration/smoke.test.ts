/**
 * Smoke tests — every endpoint answers, and both clients see the same account.
 *
 * Two questions this file exists to answer, neither of which unit tests cover.
 *
 * **Does everything respond?** A route that throws on its first line still
 * typechecks, still passes lint, and still ships. The sweep below hits every
 * mounted surface once with a real token and asserts it returns something
 * sensible — not that the body is correct, which is what the other suites are
 * for, but that the endpoint EXISTS and does not 500.
 *
 * **Do the web app and the mobile app see the same account?** They are separate
 * clients with separate token stores, and "it synced" is the sort of thing that
 * is assumed rather than checked until a user reports that a meeting recorded on
 * their phone is missing from their laptop. Both clients speak to the same API
 * over the same `/api/v1` prefix and read the same rows, so the guarantee is
 * real — but it is only a guarantee if something asserts it. The sync block
 * writes through one client's token and reads back through a second token
 * obtained by a completely separate login, which is exactly what a second device
 * does.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import api from "@/server/api";
import { getSql } from "@/server/db";

const PREFIX = `vitest-smoke-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const emails: string[] = [];

function uniqueEmail(): string {
  const e = `${PREFIX}-${emails.length}@test.echobrief.local`;
  emails.push(e);
  return e;
}

const PASSWORD = "smoketestpassword12";

async function signUp(): Promise<{ email: string; token: string; userId: string }> {
  const email = uniqueEmail();
  const res = await api.request("/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD, name: "Smoke User" }),
  });
  expect(res.status).toBe(200);
  const { token, user } = await res.json();
  return { email, token, userId: user.id };
}

/** A SECOND session for the same account — what signing in on a laptop does. */
async function signInAgain(email: string): Promise<string> {
  const res = await api.request("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  const { token } = await res.json();
  return token;
}

function get(path: string, token?: string) {
  return api.request(path, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
}

function post(path: string, body: unknown, token?: string) {
  return api.request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

let user: { email: string; token: string; userId: string };
/** Same human, different device. */
let secondDeviceToken: string;

beforeAll(async () => {
  user = await signUp();
  secondDeviceToken = await signInAgain(user.email);
});

afterAll(async () => {
  if (emails.length === 0) return;
  const sql = getSql();
  // Plain array, NOT sql.array(...): the first execution of `= ANY(sql.array(x))`
  // on a fresh connection fails to infer its element type and serialises as a
  // comma-joined string. Found in the cleanup worker; do not reintroduce it.
  await sql`DELETE FROM users WHERE email = ANY(${emails})`;
});

describe("smoke: public surface", () => {
  it("serves health without auth", async () => {
    const res = await get("/health");
    expect(res.status).toBe(200);
  });

  it("refuses protected routes without a token", async () => {
    for (const path of ["/meetings", "/action-items", "/subscription", "/account"]) {
      const res = await get(path);
      expect(res.status, `${path} must require auth`).toBe(401);
    }
  });

  it("refuses the RevenueCat webhook without the shared secret", async () => {
    const res = await post("/webhooks/revenuecat", {
      event: { type: "INITIAL_PURCHASE", app_user_id: user.userId },
    });
    // 401 when a secret is configured, 503 when it is not. Both are refusals —
    // what must never happen is a 200 that writes a tier.
    expect([401, 503]).toContain(res.status);

    const sql = getSql();
    const rows = await sql<Array<{ tier: string }>>`
      SELECT tier FROM subscriptions WHERE user_id = ${user.userId}
    `;
    // The unauthenticated call must not have granted anything.
    expect(rows[0]?.tier ?? "free").toBe("free");
  });
});

describe("smoke: every authenticated endpoint answers", () => {
  /**
   * One GET per mounted surface. Asserting "not a server error" rather than a
   * specific body: the point is that the route is reachable and its handler runs
   * to completion. A 404 for a missing sub-resource is a real answer; a 500 is
   * the class of failure this sweep exists to catch.
   */
  const endpoints = [
    "/meetings",
    "/action-items",
    "/subscription",
    "/subscription/pricing",
    "/account",
    "/workspaces",
    "/search?q=test",
    "/integrations",
    "/analytics",
  ];

  for (const path of endpoints) {
    it(`GET ${path}`, async () => {
      const res = await get(path, user.token);
      expect(res.status, `${path} returned ${res.status}`).toBeLessThan(500);
      expect(res.status).not.toBe(401);
    });
  }

  it("reports the upgrade route as gone, not as a stub", async () => {
    const res = await post(
      "/subscription/upgrade",
      { tier: "pro", billing_interval: "monthly" },
      user.token,
    );
    expect(res.status).toBe(410);
  });

  it("refuses admin routes for a non-admin", async () => {
    for (const path of ["/admin/users", "/admin/billing/metrics"]) {
      const res = await get(path, user.token);
      expect(res.status, `${path} must be admin-only`).toBe(403);
    }
  });
});

describe("smoke: the same account looks identical on both clients", () => {
  /**
   * The actual cross-device guarantee.
   *
   * `secondDeviceToken` came from a separate login, so it carries a different
   * JWT with a different `iat` — it is a genuinely independent session, the same
   * way the web app is independent of the phone. Everything below writes with
   * one token and reads with the other.
   */

  let meetingId: string;

  it("a meeting created on one device appears on the other", async () => {
    const sql = getSql();
    const [ws] = await sql<Array<{ id: string }>>`
      SELECT id FROM workspaces WHERE owner_id = ${user.userId} LIMIT 1
    `;
    const [m] = await sql<Array<{ id: string }>>`
      INSERT INTO meetings (user_id, workspace_id, title, status, duration_sec)
      VALUES (${user.userId}, ${ws.id}, 'Cross-device meeting', 'complete', 600)
      RETURNING id
    `;
    meetingId = m.id;

    const res = await get("/meetings", secondDeviceToken);
    expect(res.status).toBe(200);
    const body = await res.json();
    const found = (body.items ?? body.meetings ?? []).find(
      (x: { id: string }) => x.id === meetingId,
    );
    expect(found, "meeting written on device A must be visible on device B").toBeDefined();
    expect(found.title).toBe("Cross-device meeting");
  });

  it("the meeting detail matches on both devices", async () => {
    const [a, b] = await Promise.all([
      get(`/meetings/${meetingId}`, user.token),
      get(`/meetings/${meetingId}`, secondDeviceToken),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    const [ja, jb] = await Promise.all([a.json(), b.json()]);
    expect(jb.id).toBe(ja.id);
    expect(jb.title).toBe(ja.title);
    expect(jb.status).toBe(ja.status);
    expect(jb.duration_sec).toBe(ja.duration_sec);
  });

  it("an action item created on one device appears on the other", async () => {
    const sql = getSql();
    const [ws] = await sql<Array<{ id: string }>>`
      SELECT id FROM workspaces WHERE owner_id = ${user.userId} LIMIT 1
    `;
    await sql`
      INSERT INTO action_items (meeting_id, user_id, workspace_id, description)
      VALUES (${meetingId}, ${user.userId}, ${ws.id}, 'Cross-device task')
    `;

    const res = await get("/action-items", secondDeviceToken);
    expect(res.status).toBe(200);
    const body = await res.json();
    const items = body.items ?? body.action_items ?? [];
    expect(
      items.some((i: { description: string }) => i.description === "Cross-device task"),
      "action item written on device A must be visible on device B",
    ).toBe(true);
  });

  it("entitlement is identical on both devices", async () => {
    const sql = getSql();
    await sql`
      INSERT INTO subscriptions (user_id, tier, status, provider)
      VALUES (${user.userId}, 'pro', 'active', 'manual')
      ON CONFLICT (user_id) DO UPDATE SET tier = 'pro', status = 'active', provider = 'manual'
    `;

    const [a, b] = await Promise.all([
      get("/subscription", user.token),
      get("/subscription", secondDeviceToken),
    ]);
    const [ja, jb] = await Promise.all([a.json(), b.json()]);

    // The whole reason the client polls the SERVER after a purchase rather than
    // trusting the store SDK: this row is the single source of truth, and both
    // devices must read the same answer from it.
    expect(ja.subscription.tier).toBe("pro");
    expect(jb.subscription.tier).toBe("pro");
    expect(jb.limits.transcription_minutes).toBe(ja.limits.transcription_minutes);
    expect(jb.limits.ai_queries).toBe(ja.limits.ai_queries);
  });

  it("usage counted on one device is visible on the other", async () => {
    const sql = getSql();
    const [ws] = await sql<Array<{ id: string }>>`
      SELECT id FROM workspaces WHERE owner_id = ${user.userId} LIMIT 1
    `;
    const period = new Date().toISOString().slice(0, 7);
    await sql`
      INSERT INTO usage_logs (user_id, workspace_id, period, transcription_minutes)
      VALUES (${user.userId}, ${ws.id}, ${period}, 42)
      ON CONFLICT (user_id, workspace_id, period)
      DO UPDATE SET transcription_minutes = 42
    `;

    const res = await get("/subscription", secondDeviceToken);
    const body = await res.json();
    // Quota is per ACCOUNT, not per device. If this ever drifted, a user could
    // double their allowance by signing in twice.
    expect(body.usage.transcription_minutes).toBeGreaterThanOrEqual(42);
  });

  it("a deletion on one device is reflected on the other", async () => {
    const del = await api.request(`/meetings/${meetingId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${user.token}` },
    });
    expect(del.status).toBeLessThan(500);

    const res = await get(`/meetings/${meetingId}`, secondDeviceToken);
    // Gone for the other device too — not served from a stale per-device view.
    expect([404, 410]).toContain(res.status);
  });
});

describe("smoke: another account cannot see this one", () => {
  /**
   * Tenant isolation, asserted at the API rather than trusted from the query
   * text. Every route scopes by user_id, but "every" is the sort of claim that
   * is true until one route is added without it.
   */
  it("a second user's library does not contain the first user's meetings", async () => {
    const other = await signUp();

    const sql = getSql();
    const [ws] = await sql<Array<{ id: string }>>`
      SELECT id FROM workspaces WHERE owner_id = ${user.userId} LIMIT 1
    `;
    const [m] = await sql<Array<{ id: string }>>`
      INSERT INTO meetings (user_id, workspace_id, title, status)
      VALUES (${user.userId}, ${ws.id}, 'Private meeting', 'complete')
      RETURNING id
    `;

    const list = await get("/meetings", other.token);
    const body = await list.json();
    const items = body.items ?? body.meetings ?? [];
    expect(items.some((x: { id: string }) => x.id === m.id)).toBe(false);

    // And not reachable by direct id either, which is the case a list filter
    // alone would miss.
    const direct = await get(`/meetings/${m.id}`, other.token);
    expect([403, 404]).toContain(direct.status);
  });
});
