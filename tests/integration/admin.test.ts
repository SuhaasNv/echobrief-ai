/**
 * Integration tests for /api/v1/admin/* — gated by requireAdmin.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import api from "@/server/api";
import { getSql } from "@/server/db";

const TEST_PREFIX = `vitest-adm-${Date.now()}`;
let adminToken = "";
let userToken = "";
let adminEmail = "";
let userEmail = "";

async function postJson(path: string, body: unknown) {
  return api.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  // Create a regular user via the auth flow
  userEmail = `${TEST_PREFIX}-user@test.echobrief.local`;
  const uResp = await postJson("/auth/signup", {
    email: userEmail,
    password: "testpassword12",
    name: "Regular",
  });
  userToken = (await uResp.json()).token;

  // Create an admin user by inserting with is_admin=true, then logging in via the normal flow
  adminEmail = `${TEST_PREFIX}-admin@test.echobrief.local`;
  const aResp = await postJson("/auth/signup", {
    email: adminEmail,
    password: "testpassword12",
    name: "Admin",
  });
  const aBody = await aResp.json();
  expect(aResp.status).toBe(200);

  // Promote to admin in DB (no API for this — admins are seeded out-of-band)
  const sql = getSql();
  await sql`UPDATE users SET is_admin = TRUE WHERE id = ${aBody.user.id}`;

  // Log in again to get a fresh token; the middleware re-reads is_admin on every
  // request via getSession-style lookup so the existing token would also work,
  // but logging in is the realistic flow.
  const li = await postJson("/auth/login", { email: adminEmail, password: "testpassword12" });
  adminToken = (await li.json()).token;
});

afterAll(async () => {
  const sql = getSql();
  await sql`DELETE FROM users WHERE email IN (${userEmail}, ${adminEmail})`;
});

describe("admin gating", () => {
  it("returns 403 for non-admin on /admin/users", async () => {
    const res = await api.request("/admin/users", {
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("forbidden");
  });

  it("returns 401 with no token on /admin/users", async () => {
    const res = await api.request("/admin/users");
    expect(res.status).toBe(401);
  });

  it("returns 200 for admin on /admin/users", async () => {
    const res = await api.request("/admin/users", {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.items)).toBe(true);
    // Our test admin should be in the list
    expect(
      body.items.some(
        (u: { email: string; is_admin: boolean }) => u.email === adminEmail && u.is_admin === true,
      ),
    ).toBe(true);
  });

  it("returns runtime info on /admin/system", async () => {
    const res = await api.request("/admin/system", {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runtime.env).toBeDefined();
    expect(body.runtime.node_version).toMatch(/^v\d+/);
    expect(Array.isArray(body.services)).toBe(true);
    // Postgres should always come back ok if this test is running
    expect(
      body.services.find((s: { name: string; status: string }) => s.name === "Postgres")?.status,
    ).toBe("ok");
  });
});
