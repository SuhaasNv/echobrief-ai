/**
 * Webhook notification service.
 *
 * Sends HTTP webhooks to external systems when events occur.
 * Use cases:
 * - Notify when meeting processing completes
 * - Alert on job failures
 * - Integration with external workflow systems (Zapier, Make, n8n)
 *
 * Usage:
 *   import { sendWebhook, WebhookEvent } from "./webhooks";
 *
 *   await sendWebhook(
 *     "https://hooks.zapier.com/...",
 *     "meeting.completed",
 *     { meeting_id, title, status }
 *   );
 */

export type WebhookEvent =
  | "meeting.created"
  | "meeting.processing"
  | "meeting.completed"
  | "meeting.failed"
  | "export.completed"
  | "export.failed";

export interface WebhookPayload {
  event: WebhookEvent;
  timestamp: string;
  data: Record<string, unknown>;
}

/**
 * Send a webhook to an external URL.
 *
 * Features:
 * - Automatic retries (3 attempts)
 * - Timeout protection (10s)
 * - Error logging
 * - Non-blocking (failures don't break main flow)
 *
 * @param url - Webhook endpoint URL
 * @param event - Event type
 * @param data - Event payload data
 */
export async function sendWebhook(
  url: string,
  event: WebhookEvent,
  data: Record<string, unknown>,
): Promise<void> {
  const payload: WebhookPayload = {
    event,
    timestamp: new Date().toISOString(),
    data,
  };

  const maxAttempts = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000); // 10s timeout

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "EchoBrief-Webhook/1.0",
          "X-Webhook-Event": event,
          "X-Webhook-Timestamp": payload.timestamp,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Webhook failed: ${response.status} ${response.statusText}`);
      }

      console.log(`[Webhook] Sent ${event} to ${url} (attempt ${attempt})`);
      return; // Success
    } catch (error) {
      lastError = error as Error;

      if (attempt < maxAttempts) {
        const delay = Math.pow(2, attempt - 1) * 1000; // Exponential backoff
        console.warn(
          `[Webhook] Attempt ${attempt} failed for ${event}, retrying in ${delay}ms...`,
          error instanceof Error ? error.message : error,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  // All attempts failed
  console.error(
    `[Webhook] Failed to send ${event} to ${url} after ${maxAttempts} attempts:`,
    lastError,
  );
}

/**
 * Send meeting completion webhook (if configured).
 *
 * Call from worker after successful processing.
 *
 * @param meetingId - Meeting ID
 * @param webhookUrl - Webhook URL (from meeting.webhook_url column)
 */
export async function sendMeetingCompletedWebhook(
  meetingId: string,
  webhookUrl: string,
  meetingData: {
    title: string;
    duration_sec: number;
    language: string;
    created_at: string;
  },
): Promise<void> {
  await sendWebhook(webhookUrl, "meeting.completed", {
    meeting_id: meetingId,
    ...meetingData,
  });
}

/**
 * Send meeting failure webhook (if configured).
 */
export async function sendMeetingFailedWebhook(
  meetingId: string,
  webhookUrl: string,
  error: string,
): Promise<void> {
  await sendWebhook(webhookUrl, "meeting.failed", {
    meeting_id: meetingId,
    error,
  });
}

/**
 * Send export completion webhook.
 */
export async function sendExportCompletedWebhook(
  userId: string,
  webhookUrl: string,
  downloadUrl: string,
): Promise<void> {
  await sendWebhook(webhookUrl, "export.completed", {
    user_id: userId,
    download_url: downloadUrl,
  });
}
