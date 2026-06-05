/**
 * Account Export Worker - Generates ZIP archive with all user data.
 *
 * Background job that:
 *   1. Queries all user data (meetings, transcripts, summaries, action items, etc.)
 *   2. Creates streaming ZIP archive with JSON manifests
 *   3. Uploads ZIP to R2 with 7-day presigned URL
 *   4. Sends download link via email (Resend)
 *
 * GDPR compliance: Users can request a copy of their data via POST /account/export.
 */

import archiver from "archiver";
import { Readable } from "stream";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getSql } from "../db";
import { getEnv } from "../env";
import { sendAccountExportEmail } from "../services/resend";

const EXPORT_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

let _client: S3Client | null = null;

function getClient(): S3Client {
  if (_client) return _client;
  const env = getEnv();
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    throw new Error("R2 credentials not configured");
  }
  _client = new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });
  return _client;
}

export interface ExportJob {
  user_id: string;
  email: string;
}

/**
 * Export all user data as a ZIP archive and email download link.
 */
export async function exportUserAccount(job: ExportJob): Promise<void> {
  const { user_id, email } = job;
  const sql = getSql();
  const env = getEnv();

  console.log(`[export-account] starting export for user ${user_id}`);

  // ---- 1. Query all user data -----------------------------------------------
  const [user, workspaces, meetings, transcripts, summaries, actionItems, pipelineLogs] =
    await Promise.all([
      sql<Array<{ id: string; email: string; full_name: string | null; created_at: Date }>>`
      SELECT id, email, full_name, created_at FROM users WHERE id = ${user_id} LIMIT 1
    `,
      sql<Array<{ workspace_id: string; workspace_name: string; role: string; joined_at: Date }>>`
      SELECT w.id as workspace_id, w.name as workspace_name, wm.role, wm.created_at as joined_at
      FROM workspaces w
      JOIN workspace_members wm ON wm.workspace_id = w.id
      WHERE wm.user_id = ${user_id}
      ORDER BY wm.created_at DESC
    `,
      sql<
        Array<{
          id: string;
          workspace_id: string;
          title: string;
          status: string;
          duration_sec: number | null;
          meeting_score: unknown;
          created_at: Date;
          processed_at: Date | null;
        }>
      >`
      SELECT id, workspace_id, title, status, duration_sec, meeting_score, created_at, processed_at
      FROM meetings
      WHERE user_id = ${user_id}
      ORDER BY created_at DESC
    `,
      sql<
        Array<{
          meeting_id: string;
          raw_text: string;
          language: string | null;
          provider: string | null;
          speakers: unknown;
        }>
      >`
      SELECT t.meeting_id, t.raw_text, t.language, t.provider, t.speakers
      FROM transcripts t
      JOIN meetings m ON m.id = t.meeting_id
      WHERE m.user_id = ${user_id}
      ORDER BY t.created_at DESC
    `,
      sql<
        Array<{
          meeting_id: string;
          executive: string;
          key_topics: string[];
          decisions: string[];
          open_questions: string[];
          chapters: unknown;
          generated_at: Date;
        }>
      >`
      SELECT s.meeting_id, s.executive, s.key_topics, s.decisions, s.open_questions, s.chapters, s.generated_at
      FROM summaries s
      JOIN meetings m ON m.id = s.meeting_id
      WHERE m.user_id = ${user_id}
      ORDER BY s.generated_at DESC
    `,
      sql<
        Array<{
          id: string;
          meeting_id: string;
          description: string;
          assignee_name: string | null;
          due_date: string | null;
          timestamp_sec: number | null;
          status: string;
          completed_at: Date | null;
          created_at: Date;
        }>
      >`
      SELECT id, meeting_id, description, assignee_name, due_date, timestamp_sec, status, completed_at, created_at
      FROM action_items
      WHERE user_id = ${user_id}
      ORDER BY created_at DESC
    `,
      sql<
        Array<{
          meeting_id: string;
          step: string;
          provider: string | null;
          model: string | null;
          duration_ms: number | null;
          cost_usd: number | null;
          status: string;
          error: string | null;
          created_at: Date;
        }>
      >`
      SELECT meeting_id, step, provider, model, duration_ms, cost_usd, status, error, created_at
      FROM pipeline_logs
      WHERE user_id = ${user_id}
      ORDER BY created_at DESC
    `,
    ]);

  if (user.length === 0) {
    throw new Error(`User ${user_id} not found`);
  }

  console.log(
    `[export-account] queried data: ${meetings.length} meetings, ${actionItems.length} action items`,
  );

  // ---- 2. Build ZIP archive -------------------------------------------------
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const zipKey = `exports/${user_id}/${timestamp}.zip`;

  // Create archiver instance
  const archive = archiver("zip", {
    zlib: { level: 6 }, // Compression level (0-9)
  });

  // Track upload progress
  archive.on("warning", (err: archiver.ArchiverError) => {
    if (err.code === "ENOENT") {
      console.warn("[export-account] archiver warning:", err);
    } else {
      throw err;
    }
  });

  archive.on("error", (err: Error) => {
    throw err;
  });

  // Create metadata
  const metadata = {
    export_timestamp: new Date().toISOString(),
    user: user[0],
    stats: {
      meetings: meetings.length,
      transcripts: transcripts.length,
      summaries: summaries.length,
      action_items: actionItems.length,
      workspaces: workspaces.length,
    },
    note: "Audio files are not included due to size constraints. Contact support if you need access to original recordings.",
  };

  // Add JSON files to archive
  archive.append(JSON.stringify(metadata, null, 2), { name: "metadata.json" });
  archive.append(JSON.stringify(meetings, null, 2), { name: "meetings.json" });
  archive.append(JSON.stringify(transcripts, null, 2), { name: "transcripts.json" });
  archive.append(JSON.stringify(summaries, null, 2), { name: "summaries.json" });
  archive.append(JSON.stringify(actionItems, null, 2), { name: "action_items.json" });
  archive.append(JSON.stringify(pipelineLogs, null, 2), { name: "pipeline_logs.json" });
  archive.append(JSON.stringify(workspaces, null, 2), { name: "workspaces.json" });

  // Finalize archive (no more appends after this)
  archive.finalize();

  // ---- 3. Upload ZIP to R2 --------------------------------------------------
  console.log(`[export-account] uploading ZIP to R2: ${zipKey}`);

  // Convert archive stream to buffer for S3 upload
  const chunks: Buffer[] = [];
  const archiveStream = Readable.from(archive);

  for await (const chunk of archiveStream) {
    chunks.push(Buffer.from(chunk));
  }
  const zipBuffer = Buffer.concat(chunks);

  await getClient().send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: zipKey,
      Body: zipBuffer,
      ContentType: "application/zip",
    }),
  );

  console.log(`[export-account] ZIP uploaded (${(zipBuffer.length / 1024 / 1024).toFixed(2)} MB)`);

  // ---- 4. Generate presigned download URL -----------------------------------
  const downloadUrl = await getSignedUrl(
    getClient(),
    new GetObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: zipKey,
    }),
    { expiresIn: EXPORT_TTL_SECONDS },
  );

  const expiresAt = new Date(Date.now() + EXPORT_TTL_SECONDS * 1000).toISOString();

  console.log(`[export-account] presigned URL generated (expires: ${expiresAt})`);

  // ---- 5. Send email with download link -------------------------------------
  await sendAccountExportEmail(email, downloadUrl, expiresAt);

  console.log(`[export-account] email sent to ${email}`);
  console.log(`[export-account] export complete for user ${user_id}`);
}
