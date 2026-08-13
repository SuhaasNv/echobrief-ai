import * as Notifications from "expo-notifications";

import { api } from "@/lib/api/client";
import { hydrateSession } from "@/lib/api/token-store";
import type { MeetingListResponse, MeetingSummary } from "@/lib/api/meetings";

import { hasNotificationPermission } from "./permissions";
import {
  claimNotification,
  getNotificationsEnabled,
  getPendingMeetings,
  releaseNotification,
  removePendingMeeting,
} from "./store";

/**
 * Turning "a meeting finished" into exactly one useful notification.
 *
 * Both detection paths (the foreground poll in meeting-status.ts and the
 * background task) funnel through announceMeeting, so the dedupe rule lives in
 * one place and cannot be half-applied.
 */

/** Carried in the notification payload so a tap knows where to go. */
export const MEETING_ID_DATA_KEY = "meetingId";

export interface MeetingAnnouncement {
  id: string;
  title: string;
  status: MeetingSummary["status"];
  actionItemCount: number | null;
}

/**
 * Copy.
 *
 * The title is the MEETING's name, never "EchoBrief". The user knows which app
 * it is; what they do not know is which of their recordings just finished, and
 * on the lock screen the title is the only line guaranteed to be read.
 *
 * The body spends the one moment of attention on something actionable. "Ready"
 * on its own tells them nothing they could not infer from the fact that a
 * notification arrived at all.
 */
export function notificationCopy(announcement: MeetingAnnouncement): {
  title: string;
  body: string;
} {
  const title = announcement.title.trim() || "Your meeting";

  if (announcement.status === "failed") {
    return {
      title,
      // Calm, specific, and points at the recovery. No "error", no "failed",
      // and it says the audio is safe because that is the actual worry.
      body: "We could not finish this one. Your recording is safe, so you can try again.",
    };
  }

  const count = announcement.actionItemCount;

  if (count === null) {
    return { title, body: "Your summary is ready to read." };
  }
  if (count === 0) {
    return { title, body: "Your summary is ready. No action items came out of this one." };
  }
  return {
    title,
    body: `Your summary is ready, with ${count} action item${count === 1 ? "" : "s"} to review.`,
  };
}

/**
 * Post one notification for a meeting, at most once ever.
 *
 * The claim is taken and PERSISTED before the notification is scheduled, so two
 * callers racing cannot both win. If scheduling then throws, the claim is handed
 * back so a later pass can retry.
 *
 * Returns true if a notification was actually posted.
 */
export async function announceMeeting(announcement: MeetingAnnouncement): Promise<boolean> {
  if (!(await getNotificationsEnabled())) {
    // The user turned this off. Still drop it from pending, otherwise the
    // background task keeps waking up for a meeting it will never announce.
    await removePendingMeeting(announcement.id);
    return false;
  }

  if (!(await hasNotificationPermission())) {
    await removePendingMeeting(announcement.id);
    return false;
  }

  if (!(await claimNotification(announcement.id))) return false;

  const { title, body } = notificationCopy(announcement);

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: true,
        data: { [MEETING_ID_DATA_KEY]: announcement.id },
      },
      // null means deliver now. This is a local notification: no server, no
      // push token, no aps-environment entitlement.
      trigger: null,
    });
    return true;
  } catch {
    await releaseNotification(announcement.id);
    return false;
  }
}

/**
 * Mark a meeting as handled without posting anything.
 *
 * Used when the user is already looking at the app as the meeting resolves.
 * Telling someone what they are currently watching is noise, and consuming the
 * claim here is what stops the background task announcing it ten minutes later.
 */
export async function suppressMeetingAnnouncement(id: string): Promise<void> {
  await claimNotification(id);
}

/**
 * Check every pending meeting and announce the ones that finished.
 *
 * One request, not one per meeting: `/meetings` returns status, title AND
 * action_item_count together, which is exactly the payload a notification needs.
 * Polling `/meetings/:id/status` per pending id would be N round trips and still
 * would not carry the action item count.
 *
 * Returns the number of notifications posted.
 */
export async function reconcilePendingMeetings(): Promise<number> {
  const pending = await getPendingMeetings();
  if (pending.length === 0) return 0;

  if (!(await getNotificationsEnabled())) return 0;

  // The background task can run before the root layout has hydrated the session,
  // so the auth token may not be in memory yet. Idempotent, so this is free when
  // the app is already running.
  await hydrateSession();

  const response = await api.apiRequest<MeetingListResponse>("/meetings", {
    // Comfortably more than MAX_PENDING, so a pending meeting cannot have fallen
    // off the end of the page. Server caps limit at 100.
    query: { page: 1, limit: 50 },
  });

  const byId = new Map(response.items.map((item) => [item.id, item]));
  let posted = 0;

  for (const entry of pending) {
    const meeting = byId.get(entry.id);

    // Not in the list at all: deleted, or belongs to another workspace now.
    // Either way it will never resolve for us.
    if (!meeting) {
      await removePendingMeeting(entry.id);
      continue;
    }

    if (meeting.status !== "complete" && meeting.status !== "failed") continue;

    const announced = await announceMeeting({
      id: meeting.id,
      // Prefer the server's title: the user may have renamed it since upload.
      title: meeting.title || entry.title,
      status: meeting.status,
      actionItemCount: meeting.action_item_count,
    });

    if (announced) posted += 1;
  }

  return posted;
}
