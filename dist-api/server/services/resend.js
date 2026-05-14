/**
 * Resend transactional email service.
 */
import { Resend } from "resend";
import { getEnv } from "../env";
const FROM_ADDRESS = "EchoBrief <hello@echobrief.ai>";
let _client = null;
function getClient() {
    if (_client)
        return _client;
    const env = getEnv();
    if (!env.RESEND_API_KEY)
        return null;
    _client = new Resend(env.RESEND_API_KEY);
    return _client;
}
export async function sendProcessingCompleteEmail(to, meetingTitle, meetingUrl) {
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
export async function sendProcessingFailedEmail(to, meetingTitle, reason) {
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
export async function sendWorkspaceInvite(to, workspaceName, inviteUrl) {
    const client = getClient();
    if (!client) {
        console.log(`[resend stub] workspace invite to ${to}`);
        return;
    }
    await client.emails.send({
        from: FROM_ADDRESS,
        to,
        subject: `You're invited to ${workspaceName} on EchoBrief`,
        html: `
      <p>You've been invited to join <strong>${escapeHtml(workspaceName)}</strong>.</p>
      <p><a href="${inviteUrl}">Accept invitation →</a></p>
    `,
    });
}
function escapeHtml(s) {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
//# sourceMappingURL=resend.js.map