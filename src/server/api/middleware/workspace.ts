/**
 * Workspace middleware. Mount AFTER requireAuth.
 *
 * Resolves the active workspace from the `X-Workspace-Id` header. Falls back
 * to the user's first (oldest) owned workspace when the header is absent —
 * keeps single-workspace users from having to send the header at all.
 *
 * Verifies the user is a member of the workspace. Sets c.var.workspaceId.
 */

import type { MiddlewareHandler } from "hono";
import { getSql } from "../../db";
import type { AppBindings } from "../types";

export const requireWorkspace: MiddlewareHandler<AppBindings> = async (c, next) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "unauthorized", message: "Auth required" }, 401);
  }

  const sql = getSql();
  const headerId = c.req.header("x-workspace-id")?.trim();

  let workspaceId: string | null = null;

  if (headerId) {
    const rows = await sql<{ workspace_id: string }[]>`
      SELECT workspace_id FROM workspace_members
      WHERE workspace_id = ${headerId} AND user_id = ${user.id}
      LIMIT 1
    `;
    if (rows.length === 0) {
      return c.json(
        { error: "forbidden", message: "Not a member of this workspace" },
        403,
      );
    }
    workspaceId = rows[0].workspace_id;
  } else {
    const rows = await sql<{ id: string }[]>`
      SELECT w.id
      FROM workspaces w
      JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = ${user.id}
      ORDER BY w.created_at ASC
      LIMIT 1
    `;
    if (rows.length === 0) {
      return c.json(
        { error: "no_workspace", message: "User has no workspace yet" },
        409,
      );
    }
    workspaceId = rows[0].id;
  }

  c.set("workspaceId", workspaceId);
  await next();
};
