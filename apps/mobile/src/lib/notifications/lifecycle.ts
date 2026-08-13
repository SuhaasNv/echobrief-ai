import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import * as Notifications from "expo-notifications";
import { router, usePathname, useRootNavigationState } from "expo-router";

import { MEETING_ID_DATA_KEY, reconcilePendingMeetings } from "./notify";
import { syncBackgroundTaskRegistration } from "./task";

/**
 * Foreground presentation, deep linking, badge, and cleanup.
 *
 * Set at module scope so the behaviour is in place before any notification can
 * arrive, including one that arrives during the first render.
 *
 * shouldShowBanner is FALSE on purpose. A banner that drops over the screen the
 * user is already looking at is the classic amateur tell: they are in the app,
 * they can see the meeting, and the banner covers the thing it is announcing.
 * shouldShowList stays true so it is still in Notification Centre if they
 * scrolled past it, and the badge still increments.
 *
 * This handler only runs while the app is FOREGROUNDED. Backgrounded, iOS
 * presents the banner itself and none of this applies, which is exactly what we
 * want.
 */
Notifications.setNotificationHandler({
  handleNotification: () =>
    Promise.resolve({
      shouldShowBanner: false,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: true,
    }),
});

/** Pull the meeting id out of a notification payload without trusting its shape. */
function meetingIdFrom(notification: Notifications.Notification): string | null {
  const data: unknown = notification.request.content.data;
  if (typeof data !== "object" || data === null) return null;

  const value = (data as Record<string, unknown>)[MEETING_ID_DATA_KEY];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Route a notification tap to its meeting, on cold start and warm tap alike.
 *
 * useLastNotificationResponse covers both: it replays the response that launched
 * the app, and updates when one is tapped while running. That matters because
 * cold start is the case that is usually broken — the response is delivered
 * before any navigator exists, so a plain listener fires into a router that
 * cannot navigate and the tap silently does nothing.
 *
 * Two guards make that safe:
 *
 *   useRootNavigationState() stays undefined until the navigator is mounted, so
 *   the route is held until navigation can actually happen.
 *
 *   handled tracks the notification identifier, because the hook keeps
 *   returning the same response after it has been consumed. Without it, every
 *   remount would yank the user back to the same meeting.
 */
function useNotificationDeepLink(): void {
  const response = Notifications.useLastNotificationResponse();
  const navigationState = useRootNavigationState();
  const handled = useRef<string | null>(null);

  // Truthy only once the root navigator has mounted and has routes.
  const navigatorReady = Boolean(navigationState?.key);

  useEffect(() => {
    if (!navigatorReady || !response) return;

    const identifier = response.notification.request.identifier;
    if (handled.current === identifier) return;

    const meetingId = meetingIdFrom(response.notification);
    if (!meetingId) return;

    handled.current = identifier;

    // push, not replace: the tab the user was on stays underneath, so the back
    // gesture returns somewhere sensible instead of dead-ending.
    router.push(`/(app)/meetings/${meetingId}`);
  }, [navigatorReady, response]);
}

/**
 * Clear the badge and catch up on anything that finished while we were away.
 *
 * The reconcile on foreground is the reliable half of completion detection. iOS
 * suspends JS timers the moment the app backgrounds, so the React Query poll
 * does NOT keep running in the background; it resumes on return. This closes
 * that gap immediately rather than waiting for the next poll tick.
 */
function useForegroundReconcile(): void {
  useEffect(() => {
    const runForeground = (): void => {
      void Notifications.setBadgeCountAsync(0).catch(() => undefined);
      void reconcilePendingMeetings().catch(() => undefined);
      void syncBackgroundTaskRegistration();
    };

    // The app is already active when this mounts, so do the first pass now.
    runForeground();

    const subscription = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "active") runForeground();
    });

    return () => subscription.remove();
  }, []);
}

/**
 * Drop delivered notifications for a meeting the user has opened.
 *
 * Once they are reading the transcript, the banner sitting in Notification
 * Centre is stale. Leaving it there means clearing the same news twice.
 */
function useOpenedMeetingCleanup(): void {
  const pathname = usePathname();

  useEffect(() => {
    const match = /^\/(?:\(app\)\/)?meetings\/([^/]+)$/.exec(pathname);
    const meetingId = match?.[1];
    if (!meetingId) return;

    let cancelled = false;

    void (async () => {
      try {
        const presented = await Notifications.getPresentedNotificationsAsync();
        if (cancelled) return;

        await Promise.all(
          presented
            .filter((item) => meetingIdFrom(item) === meetingId)
            .map((item) =>
              Notifications.dismissNotificationAsync(item.request.identifier).catch(
                () => undefined,
              ),
            ),
        );
      } catch {
        // Cosmetic cleanup. Never worth surfacing.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pathname]);
}

/**
 * Everything the app shell needs, in one call.
 *
 * Mount once, high in the authenticated tree.
 */
export function useNotificationLifecycle(): void {
  useNotificationDeepLink();
  useForegroundReconcile();
  useOpenedMeetingCleanup();
}
