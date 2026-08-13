/**
 * Resend transactional email service.
 */

import { Resend } from "resend";
import { getEnv } from "../env";

const FROM_ADDRESS = "Puffin <hello@echobrief.ai>";

let _client: Resend | null = null;

function getClient(): Resend | null {
  if (_client) return _client;
  const env = getEnv();
  if (!env.RESEND_API_KEY) return null;
  _client = new Resend(env.RESEND_API_KEY);
  return _client;
}

export async function sendProcessingCompleteEmail(
  to: string,
  meetingTitle: string,
  meetingUrl: string,
): Promise<void> {
  const client = getClient();
  if (!client) {
    console.log(`[resend stub] processing complete email to ${to}`);
    return;
  }
  await client.emails.send({
    from: FROM_ADDRESS,
    to,
    subject: `Your meeting is ready: ${meetingTitle}`,
    html: `
      <p>Your meeting <strong>${escapeHtml(meetingTitle)}</strong> has finished processing.</p>
      <p><a href="${meetingUrl}">View summary and action items →</a></p>
    `,
  });
}

export async function sendProcessingFailedEmail(
  to: string,
  meetingTitle: string,
  reason: string,
): Promise<void> {
  const client = getClient();
  if (!client) {
    console.log(`[resend stub] processing failed email to ${to}`);
    return;
  }
  await client.emails.send({
    from: FROM_ADDRESS,
    to,
    subject: `Processing failed: ${meetingTitle}`,
    html: `
      <p>We weren't able to finish processing <strong>${escapeHtml(meetingTitle)}</strong>.</p>
      <p>Reason: ${escapeHtml(reason)}</p>
      <p>You can retry from the meeting page.</p>
    `,
  });
}

export async function sendWorkspaceInvite(
  to: string,
  workspaceName: string,
  inviteUrl: string,
): Promise<void> {
  const client = getClient();
  if (!client) {
    console.log(`[resend stub] workspace invite to ${to}`);
    return;
  }
  await client.emails.send({
    from: FROM_ADDRESS,
    to,
    subject: `You're invited to ${workspaceName} on Puffin`,
    html: `
      <p>You've been invited to join <strong>${escapeHtml(workspaceName)}</strong>.</p>
      <p><a href="${inviteUrl}">Accept invitation →</a></p>
    `,
  });
}

export async function sendAccountExportEmail(
  to: string,
  downloadUrl: string,
  expiresAt: string,
): Promise<void> {
  const client = getClient();
  if (!client) {
    console.log(`[resend stub] account export email to ${to}`);
    return;
  }

  const expiryDate = new Date(expiresAt).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  await client.emails.send({
    from: FROM_ADDRESS,
    to,
    subject: "Your Puffin data export is ready",
    html: `
      <h2>Your Data Export is Ready</h2>
      <p>We've prepared a complete export of your Puffin account data.</p>
      
      <p style="margin: 24px 0;">
        <a href="${downloadUrl}" style="background-color: #0066cc; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
          Download Your Data
        </a>
      </p>

      <p><strong>What's included:</strong></p>
      <ul>
        <li>All meeting metadata and transcripts</li>
        <li>AI-generated summaries and action items</li>
        <li>Processing logs and workspace memberships</li>
        <li>Account information and statistics</li>
      </ul>

      <p><strong>Important:</strong></p>
      <ul>
        <li>This download link expires on <strong>${escapeHtml(expiryDate)}</strong> (7 days)</li>
        <li>Audio files are not included due to size constraints</li>
        <li>All data is provided in JSON format inside a ZIP archive</li>
      </ul>

      <p style="color: #666; font-size: 14px; margin-top: 32px;">
        If you have questions about your data export, please contact our support team.
      </p>
    `,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
