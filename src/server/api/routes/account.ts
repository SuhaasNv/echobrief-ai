/**
 * /api/v1/account
 */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import argon2 from "argon2";
import { SignJWT } from "jose";
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import {
  DEFAULT_AUDIO_RETENTION_DAYS,
  UpdatePreferencesRequest,
  UpdateProfileRequest,
  type UserPreferences,
} from "../../../lib/schemas";
import { getSql } from "../../db";
import type { UserPreferencesRow } from "../../db/types";
import { enqueueExportJob } from "../../services/queue";
import { getEnv } from "../../env";
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
      default_account_type: "student" | "professional" | null;
      created_at: string;
    }>
  >`SELECT id, email, name, avatar_url, is_admin, default_account_type, created_at FROM users WHERE id = ${user.id}`;

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

  // Bumping sessions_valid_from is the point of the whole endpoint: JWTs are
  // stateless and live 7 days, so without this a user who changes their
  // password because someone else has it leaves that someone else holding a
  // working bearer token for the rest of the week.
  const newHash = await argon2.hash(new_password, { type: argon2.argon2id });

  // Cutoff is rounded UP to the next whole second, and the replacement token is
  // stamped with exactly that second.
  //
  // JWT `iat` has one-second granularity, so a cutoff of plain now() cannot
  // separate a token minted at 12:00:00.100 from one minted at 12:00:00.900 —
  // both carry iat 12:00:00. Comparing in whole seconds then had to use a
  // strict `<` to keep the replacement alive, which also kept alive any stolen
  // token minted in that same second. That is the exact window an attacker
  // occupies: they are using the account, the victim changes the password, and
  // both requests land in the same second.
  //
  // Rounding the cutoff up removes the ambiguity instead of papering over it:
  // every token issued at or before this second is strictly older than the
  // cutoff and dies, and the replacement is explicitly dated to the cutoff so
  // it survives without needing a lenient comparison.
  const [row] = await sql<Array<{ sessions_valid_from: Date }>>`
    UPDATE users
    SET password_hash = ${newHash},
        sessions_valid_from = date_trunc('second', now()) + interval '1 second',
        updated_at = now()
    WHERE id = ${user.id}
    RETURNING sessions_valid_from
  `;
  if (!row) {
    throw new HTTPException(404, { message: "Account not found" });
  }

  // Every outstanding token for this account — including the one that made this
  // request — is now dead. Hand back a fresh one so the caller can swap it in
  // and stay signed in; clients that ignore it simply land back on sign-in,
  // which is the correct outcome, not a regression.
  const env = getEnv();
  const cutoffSec = Math.floor(new Date(row.sessions_valid_from).getTime() / 1000);
  const token = await new SignJWT({ email: user.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt(cutoffSec)
    .setExpirationTime("7d")
    .sign(new TextEncoder().encode(env.AUTH_SECRET));

  return c.json({ ok: true, token });
});

// ---- Pipeline preferences ---------------------------------------------------
//
// Scoped to (user, workspace), like every other partitioned table here — the
// active workspace comes from requireWorkspace, which is mounted on this path
// (and only this path under /account) in api/index.ts. /account/me deliberately
// stays workspace-free: a user with no workspace yet must still be able to load
// their profile, and requireWorkspace answers 409 in that case.

/** The stored columns the API cares about; created_at/updated_at are internal. */
type StoredPreferences = Pick<
  UserPreferencesRow,
  "transcription_language" | "vocabulary" | "audio_retention_days"
>;

/**
 * Absence is the common case, not an error: a row only exists once someone has
 * saved a preference, so an unconfigured account answers with nulls and the
 * pipeline keeps doing exactly what it did before this endpoint existed.
 */
function toPreferences(row: StoredPreferences | undefined): UserPreferences {
  return {
    transcription_language: row?.transcription_language ?? null,
    vocabulary: row?.vocabulary ?? [],
    audio_retention_days: row?.audio_retention_days ?? null,
    default_audio_retention_days: DEFAULT_AUDIO_RETENTION_DAYS,
  };
}

app.get("/preferences", async (c) => {
  const user = c.get("user");
  const workspaceId = c.get("workspaceId");
  const sql = getSql();

  const rows = await sql<StoredPreferences[]>`
    SELECT transcription_language, vocabulary, audio_retention_days
    FROM user_preferences
    WHERE user_id = ${user.id} AND workspace_id = ${workspaceId}
  `;

  return c.json(toPreferences(rows[0]));
});

app.patch("/preferences", zValidator("json", UpdatePreferencesRequest), async (c) => {
  const patch = c.req.valid("json");
  const user = c.get("user");
  const workspaceId = c.get("workspaceId");
  const sql = getSql();

  // `!== undefined` rather than a truthiness or nullish check: null is a
  // meaningful value on every one of these fields (it clears the preference back
  // to the platform behaviour), so "absent" and "explicitly null" must not
  // collapse into the same branch.
  const sets = [];
  if (patch.transcription_language !== undefined) {
    sets.push(sql`transcription_language = EXCLUDED.transcription_language`);
  }
  if (patch.vocabulary !== undefined) {
    sets.push(sql`vocabulary = EXCLUDED.vocabulary`);
  }
  if (patch.audio_retention_days !== undefined) {
    sets.push(sql`audio_retention_days = EXCLUDED.audio_retention_days`);
  }
  const setClause = sets.reduce((acc, cur, i) => (i === 0 ? cur : sql`${acc}, ${cur}`));

  // One upsert rather than SELECT-then-INSERT-or-UPDATE: two devices saving
  // different settings at the same moment would otherwise race on the read and
  // the loser would insert over the winner's row.
  //
  // Omitted fields fall to the column defaults on INSERT, and are left untouched
  // on UPDATE because they are not in the SET list. Those defaults are the same
  // "unset" nulls the reader treats as no-preference, which is what keeps
  // saving a vocabulary term from silently reassigning someone's language.
  const rows = await sql<StoredPreferences[]>`
    INSERT INTO user_preferences (
      user_id, workspace_id, transcription_language, vocabulary, audio_retention_days
    ) VALUES (
      ${user.id},
      ${workspaceId},
      ${patch.transcription_language ?? null},
      ${sql.array(patch.vocabulary ?? [])}::text[],
      ${patch.audio_retention_days ?? null}
    )
    ON CONFLICT (user_id, workspace_id) DO UPDATE SET ${setClause}, updated_at = now()
    RETURNING transcription_language, vocabulary, audio_retention_days
  `;

  // Returning the merged row saves the client a follow-up GET and, more
  // usefully, lets it see what the server actually kept.
  return c.json(toPreferences(rows[0]));
});

app.post("/export", async (c) => {
  const user = c.get("user");

  // Enqueue background job to build ZIP and email download link
  await enqueueExportJob({
    user_id: user.id,
    email: user.email,
  });

  return c.json({
    queued: true,
    message: `Export queued for ${user.email}. You'll receive an email within 1 hour.`,
  });
});

app.delete("/me", async (c) => {
  const user = c.get("user");
  const sql = getSql();
  const env = getEnv();

  // ---- 1. Delete R2 audio files (best-effort) ------------------------------
  // List all audio files under user's prefix and batch delete them.
  // R2 cleanup failures are logged but don't block account deletion (GDPR
  // compliance at DB level is mandatory; R2 cleanup is nice-to-have).
  try {
    if (env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY) {
      const client = new S3Client({
        region: "auto",
        endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: env.R2_ACCESS_KEY_ID,
          secretAccessKey: env.R2_SECRET_ACCESS_KEY,
        },
      });

      let deletedCount = 0;
      let continuationToken: string | undefined;

      do {
        // List all objects with user's prefix
        const listResponse = await client.send(
          new ListObjectsV2Command({
            Bucket: env.R2_BUCKET,
            Prefix: `${user.id}/`, // All audio files under userId/
            ContinuationToken: continuationToken,
            MaxKeys: 1000,
          }),
        );

        const objects = listResponse.Contents ?? [];
        if (objects.length === 0) break;

        // Batch delete all objects in this page
        const deleteResponse = await client.send(
          new DeleteObjectsCommand({
            Bucket: env.R2_BUCKET,
            Delete: {
              Objects: objects.map((obj) => ({ Key: obj.Key })),
              Quiet: true,
            },
          }),
        );

        const deleted = objects.length - (deleteResponse.Errors?.length ?? 0);
        deletedCount += deleted;

        if (deleteResponse.Errors && deleteResponse.Errors.length > 0) {
          console.error(
            `[account-delete] R2 deletion errors for user ${user.id}:`,
            deleteResponse.Errors.slice(0, 5),
          );
        }

        continuationToken = listResponse.NextContinuationToken;
      } while (continuationToken);

      console.log(
        `[account-delete] deleted ${deletedCount} audio files from R2 for user ${user.id}`,
      );
    }
  } catch (err) {
    // Log R2 cleanup failures but don't block account deletion
    console.error(`[account-delete] R2 cleanup failed for user ${user.id}:`, err);
  }

  // ---- 2. Delete user from database -----------------------------------------
  // ON DELETE CASCADE in migrations removes meetings, transcripts, chunks, etc.
  await sql`DELETE FROM users WHERE id = ${user.id}`;

  // TODO: revoke Better Auth sessions (if using session-based auth).

  return c.json({ ok: true });
});

export default app;
