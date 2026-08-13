/**
 * Local meeting notifications.
 *
 * LOCAL ONLY. There is no push token, no server-side delivery, and no
 * `aps-environment` entitlement anywhere in this app — see
 * ./no-push-entitlement.js for why that is load-bearing rather than incidental.
 * Do not add `getExpoPushTokenAsync`; it will not work on this signing account.
 *
 * Importing this barrel is what evaluates ./task and ./lifecycle, which is how
 * TaskManager.defineTask and setNotificationHandler get installed. Both must
 * happen at module scope, so this import has a side effect on purpose.
 */

// Side-effecting: defines the background task at module scope.
import "./task";
// Side-effecting: installs the foreground presentation handler.
import "./lifecycle";

export { useNotificationLifecycle } from "./lifecycle";

export {
  ensureNotificationPermission,
  hasNotificationPermission,
  openNotificationSettings,
} from "./permissions";

export {
  announceMeeting,
  notificationCopy,
  reconcilePendingMeetings,
  suppressMeetingAnnouncement,
  MEETING_ID_DATA_KEY,
  type MeetingAnnouncement,
} from "./notify";

export { syncBackgroundTaskRegistration, MEETING_STATUS_TASK } from "./task";

export { useNotificationPreference, type NotificationPreference } from "./preference";

export {
  addPendingMeeting,
  clearNotificationState,
  forgetMeeting,
  getNotificationsEnabled,
  getPendingMeetings,
  getNotificationState,
  setNotificationsEnabled,
  subscribeToNotificationState,
  type NotificationState,
  type PendingMeeting,
} from "./store";
