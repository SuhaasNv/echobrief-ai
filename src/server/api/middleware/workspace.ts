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
  let workspaceKind: "student" | "professional" | null = null;

  if (headerId) {
    const rows = await sql<{ workspace_id: string; kind: "student" | "professional" }[]>`
      SELECT m.workspace_id, w.kind
      FROM workspace_members m
      JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.workspace_id = ${headerId} AND m.user_id = ${user.id}
      LIMIT 1
    `;
    if (rows.length === 0) {
      return c.json(
        { error: "forbidden", message: "Not a member of this workspace" },
        403,
      );
    }
    workspaceId = rows[0].workspace_id;
    workspaceKind = rows[0].kind;
  } else {
    const rows = await sql<{ id: string; kind: "student" | "professional" }[]>`
      SELECT w.id, w.kind
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
    workspaceKind = rows[0].kind;
  }

  c.set("workspaceId", workspaceId);
  c.set("workspaceKind", workspaceKind);
  await next();
};

/**
 * Reject requests when the active workspace isn't professional. Mount AFTER
 * requireWorkspace on any endpoint that's pro-only (integrations, exports,
 * email generation).
 */
export function requireProfessionalWorkspace() {
  return async (c: import("hono").Context<AppBindings>, next: import("hono").Next) => {
    const kind = c.get("workspaceKind");
    if (kind !== "professional") {
      return c.json(
        {
          error: "forbidden",
          message: "This feature is only available in professional workspaces.",
        },
        403,
      );
    }
    await next();
  };
}
