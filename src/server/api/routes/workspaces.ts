/**
 * /api/v1/workspaces
 *
 * Single-owner workspaces. Every authenticated user is auto-provisioned with a
 * "Personal" workspace via migration 0006. From there they can create more,
 * rename, change color, and delete (but never the last one).
 */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getSql } from "../../db";
import type { AppBindings } from "../types";

const app = new Hono<AppBindings>();

const WORKSPACE_COLORS = ["brand", "violet", "emerald", "amber", "rose", "slate"] as const;
const WorkspaceColor = z.enum(WORKSPACE_COLORS);

const CreateBody = z.object({
  name: z.string().trim().min(1).max(60),
  color: WorkspaceColor.default("brand"),
});

const UpdateBody = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  color: WorkspaceColor.optional(),
});

interface WorkspaceRow {
  id: string;
  name: string;
  color: string;
  owner_id: string;
  created_at: string;
}

// GET / — list workspaces the user is a member of
app.get("/", async (c) => {
  const user = c.get("user");
  const sql = getSql();

  const rows = await sql<WorkspaceRow[]>`
    SELECT w.id, w.name, w.color, w.owner_id, w.created_at
    FROM workspaces w
    JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = ${user.id}
    ORDER BY w.created_at ASC
  `;

  return c.json({ items: rows });
});

// POST / — create a new workspace
app.post("/", zValidator("json", CreateBody), async (c) => {
  const { name, color } = c.req.valid("json");
  const user = c.get("user");
  const sql = getSql();

  const row = await sql.begin(async (tx) => {
    const inserted = await tx<WorkspaceRow[]>`
      INSERT INTO workspaces (name, color, owner_id)
      VALUES (${name}, ${color}, ${user.id})
      RETURNING id, name, color, owner_id, created_at
    `;
    await tx`
      INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES (${inserted[0].id}, ${user.id}, 'admin')
    `;
    return inserted[0];
  });

  return c.json(row, 201);
});

// PATCH /:id — rename / recolor (owner only)
app.patch("/:id", zValidator("json", UpdateBody), async (c) => {
  const id = c.req.param("id");
  const patch = c.req.valid("json");
  const user = c.get("user");
  const sql = getSql();

  const own = await sql<{ id: string }[]>`
    SELECT id FROM workspaces WHERE id = ${id} AND owner_id = ${user.id} LIMIT 1
  `;
  if (own.length === 0) {
    throw new HTTPException(404, { message: "Workspace not found" });
  }

  const sets: ReturnType<typeof sql>[] = [];
  if (patch.name !== undefined) sets.push(sql`name = ${patch.name}`);
  if (patch.color !== undefined) sets.push(sql`color = ${patch.color}`);
  if (sets.length === 0) return c.json({ ok: true });

  const setClause = sets.reduce((acc, cur, i) => (i === 0 ? cur : sql`${acc}, ${cur}`));
  await sql`UPDATE workspaces SET ${setClause} WHERE id = ${id}`;

  return c.json({ ok: true });
});

// DELETE /:id — owner only, and never the last workspace
app.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const sql = getSql();

  const own = await sql<{ id: string }[]>`
    SELECT id FROM workspaces WHERE id = ${id} AND owner_id = ${user.id} LIMIT 1
  `;
  if (own.length === 0) {
    throw new HTTPException(404, { message: "Workspace not found" });
  }

  const [{ count }] = await sql<[{ count: number }]>`
    SELECT COUNT(*)::int AS count FROM workspaces WHERE owner_id = ${user.id}
  `;
  if (count <= 1) {
    throw new HTTPException(400, {
      message: "Can't delete your only workspace. Create another first.",
    });
  }

  // Refuse to delete a non-empty workspace — user must clear it explicitly.
  const [{ meetings_count }] = await sql<[{ meetings_count: number }]>`
    SELECT COUNT(*)::int AS meetings_count FROM meetings WHERE workspace_id = ${id}
  `;
  if (meetings_count > 0) {
    throw new HTTPException(400, {
      message: `Workspace has ${meetings_count} meeting(s). Move or delete them first.`,
    });
  }

  await sql`DELETE FROM workspaces WHERE id = ${id}`;
  return c.json({ ok: true });
});

export default app;
