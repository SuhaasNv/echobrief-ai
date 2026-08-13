import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";

import { reconcilePendingMeetings } from "./notify";
import { getPendingMeetings } from "./store";

/**
 * Background completion checks.
 *
 * READ THIS BEFORE TRUSTING IT. iOS decides if and when a BGTask runs. The
 * interval below is a floor the system is free to ignore, not a schedule:
 *
 *   - The task will NOT run at all if the user force-quit the app from the app
 *     switcher. iOS treats that as "stop doing things", and there is no API
 *     that changes it.
 *   - Delivery is budgeted against how often the user opens the app, battery
 *     level, Low Power Mode, and network state. A rarely-opened app can wait
 *     hours.
 *   - It does not run on the iOS Simulator at all. Testing requires a device.
 *
 * So this is the safety net, not the mechanism. The mechanism that always works
 * is reconcile-on-foreground (see useNotificationLifecycle): the moment the app
 * comes back, anything that finished while it was away is announced within a
 * second. The background task only buys the case where the phone is in a pocket
 * and the user never opens the app at all.
 */

export const MEETING_STATUS_TASK = "echobrief-meeting-status-check";

/** 15 minutes is the floor iOS will accept; anything smaller is silently ignored. */
const MINIMUM_INTERVAL_MINUTES = 15;

/**
 * Defined at module scope, which is mandatory: iOS can launch the app straight
 * into this task, and the handler has to already exist when the JS bundle
 * finishes evaluating. Defining it inside a component would register it only
 * after that component mounts, which is too late.
 */
TaskManager.defineTask(MEETING_STATUS_TASK, async () => {
  try {
    await reconcilePendingMeetings();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    // Reporting Failed is honest and lets iOS back off rather than retrying a
    // network call that is failing for a reason we cannot fix from here.
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

async function isRegistered(): Promise<boolean> {
  try {
    return await TaskManager.isTaskRegisteredAsync(MEETING_STATUS_TASK);
  } catch {
    return false;
  }
}

/**
 * Register only while something is actually processing.
 *
 * An always-registered task spends the app's background budget on wake-ups that
 * find an empty pending list, which makes iOS less willing to run it at the one
 * moment it matters.
 */
export async function syncBackgroundTaskRegistration(): Promise<void> {
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status === BackgroundTask.BackgroundTaskStatus.Restricted) return;

    const pending = await getPendingMeetings();
    const registered = await isRegistered();

    if (pending.length > 0 && !registered) {
      await BackgroundTask.registerTaskAsync(MEETING_STATUS_TASK, {
        minimumInterval: MINIMUM_INTERVAL_MINUTES,
      });
      return;
    }

    if (pending.length === 0 && registered) {
      await BackgroundTask.unregisterTaskAsync(MEETING_STATUS_TASK);
    }
  } catch {
    // Unavailable on simulator and restricted under some MDM profiles. The
    // foreground reconcile still covers the common case, so this is not fatal.
  }
}
