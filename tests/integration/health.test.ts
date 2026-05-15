/**
 * Sanity test — the Hono router boots and serves /health without auth.
 */

import { describe, it, expect } from "vitest";
import api from "@/server/api";

describe("GET /health", () => {
  it("returns 200 with env info", async () => {
    const res = await api.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.env).toBe("string");
  });
});
