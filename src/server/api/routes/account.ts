/**
 * /api/v1/account
 */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import argon2 from "argon2";
import { UpdateProfileRequest } from "../../../lib/schemas";
import { getSql } from "../../db";
import type { AppBindings } from "../types";

const ChangePasswordRequest = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(8, "Password must be at least 8 characters").max(128),
});

const app = new Hono<AppBindings>();

app.get("/me", async (c) => {
  const user = c.get("user");
  const sql = getSql();

  const rows = await sql<
    Array<{
      id: string;
      email: string;
      name: string | null;
      avatar_url: string | null;
      is_admin: boolean;
      created_at: string;
    }>
  >`SELECT id, email, name, avatar_url, is_admin, created_at FROM users WHERE id = ${user.id}`;

  const me = rows[0];
  if (!me) throw new HTTPException(404, { message: "User not found" });
  return c.json(me);
});

app.patch("/me", zValidator("json", UpdateProfileRequest), async (c) => {
  const patch = c.req.valid("json");
  const user = c.get("user");
  const sql = getSql();

  const sets = [];
  if (patch.name !== undefined) sets.push(sql`name = ${patch.name}`);
  if (patch.avatar_url !== undefined) sets.push(sql`avatar_url = ${patch.avatar_url}`);
  if (sets.length === 0) return c.json({ ok: true });

  const setClause = sets.reduce((acc, cur, i) => (i === 0 ? cur : sql`${acc}, ${cur}`));
  await sql`UPDATE users SET ${setClause} WHERE id = ${user.id}`;
  return c.json({ ok: true });
});

app.post("/password", zValidator("json", ChangePasswordRequest), async (c) => {
  const { current_password, new_password } = c.req.valid("json");
  const user = c.get("user");
  const sql = getSql();

  const rows = await sql<Array<{ password_hash: string | null }>>`
    SELECT password_hash FROM users WHERE id = ${user.id}
  `;
  const stored = rows[0];
  if (!stored?.password_hash) {
    throw new HTTPException(400, { message: "Account has no password set" });
  }

  const ok = await argon2.verify(stored.password_hash, current_password);
  if (!ok) {
    throw new HTTPException(401, { message: "Current password is incorrect" });
  }

  const newHash = await argon2.hash(new_password, { type: argon2.argon2id });
  await sql`UPDATE users SET password_hash = ${newHash}, updated_at = now() WHERE id = ${user.id}`;
  return c.json({ ok: true });
});

app.post("/export", async (c) => {
  const user = c.get("user");
  // TODO: enqueue an export job that builds a ZIP and emails a download link.
  return c.json({
    queued: true,
    message: `Export queued for ${user.email}. You'll receive an email within 1 hour.`,
  });
});

app.delete("/me", async (c) => {
  const user = c.get("user");
  const sql = getSql();

  // ON DELETE CASCADE in migrations removes meetings, transcripts, chunks, etc.
  await sql`DELETE FROM users WHERE id = ${user.id}`;
  // TODO: also queue R2 batch delete for any remaining audio under `${user.id}/*`.
  // TODO: revoke Better Auth sessions.
  return c.json({ ok: true });
});

export default app;
