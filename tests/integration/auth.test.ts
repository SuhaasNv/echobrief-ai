/**
 * Integration tests for /api/v1/auth + the requireAuth middleware.
 *
 * These hit the real Hono router and Railway Postgres. Each test creates a
 * uniquely-named user; afterAll wipes every vitest-* user the suite created.
 */

import { describe, it, expect, afterAll } from "vitest";
import api from "@/server/api";
import { getSql } from "@/server/db";

const TEST_PREFIX = `vitest-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
let createdEmails: string[] = [];

function uniqueEmail(): string {
  const e = `${TEST_PREFIX}-${createdEmails.length}@test.echobrief.local`;
  createdEmails.push(e);
  return e;
}

async function postJson(path: string, body: unknown, headers: Record<string, string> = {}) {
  return api.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

afterAll(async () => {
  if (createdEmails.length === 0) return;
  const sql = getSql();
  await sql`DELETE FROM users WHERE email = ANY(${sql.array(createdEmails)})`;
});

describe("POST /auth/signup", () => {
  it("creates a user and returns a JWT", async () => {
    const email = uniqueEmail();
    const res = await postJson("/auth/signup", { email, password: "testpassword12", name: "Vitest User" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBeTypeOf("string");
    expect(body.token.split(".")).toHaveLength(3); // JWT has 3 segments
    expect(body.user.email).toBe(email);
    expect(body.user.is_admin).toBe(false);
  });

  it("rejects duplicate email with 409", async () => {
    const email = uniqueEmail();
    await postJson("/auth/signup", { email, password: "testpassword12", name: "First" });
    const res = await postJson("/auth/signup", { email, password: "testpassword12", name: "Second" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("conflict");
  });

  it("rejects weak password (<8 chars)", async () => {
    const email = uniqueEmail();
    const res = await postJson("/auth/signup", { email, password: "short", name: "Weak" });
    expect(res.status).toBe(400);
  });

  it("rejects invalid email format", async () => {
    const res = await postJson("/auth/signup", { email: "not-an-email", password: "testpassword12" });
    expect(res.status).toBe(400);
  });
});

describe("POST /auth/login", () => {
  it("returns a JWT for valid credentials", async () => {
    const email = uniqueEmail();
    const password = "testpassword12";
    await postJson("/auth/signup", { email, password, name: "Login Test" });

    const res = await postJson("/auth/login", { email, password });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBeTypeOf("string");
    expect(body.user.email).toBe(email);
  });

  it("returns 401 with generic error for wrong password (no email-existence leak)", async () => {
    const email = uniqueEmail();
    await postJson("/auth/signup", { email, password: "testpassword12", name: "Wrong PW" });

    const res = await postJson("/auth/login", { email, password: "totally-wrong" });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("invalid_credentials");
    expect(body.message).not.toContain(email); // never leak email in error
  });

  it("returns the same 401 shape for non-existent email", async () => {
    const res = await postJson("/auth/login", {
      email: `nobody-${Date.now()}@example.invalid`,
      password: "doesnt-matter",
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("invalid_credentials");
  });
});

describe("requireAuth middleware", () => {
  it("returns 401 when Authorization header is missing", async () => {
    const res = await api.request("/account/me");
    expect(res.status).toBe(401);
  });

  it("returns 401 when bearer token is malformed", async () => {
    const res = await api.request("/account/me", {
      headers: { authorization: "Bearer not-a-real-token" },
    });
    expect(res.status).toBe(401);
  });

  it("returns the user on /account/me with a valid token", async () => {
    const email = uniqueEmail();
    const signup = await postJson("/auth/signup", { email, password: "testpassword12", name: "Me Test" });
    const { token } = await signup.json();

    const res = await api.request("/account/me", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const me = await res.json();
    expect(me.email).toBe(email);
    expect(me.name).toBe("Me Test");
    expect(me.is_admin).toBe(false);
  });
});
