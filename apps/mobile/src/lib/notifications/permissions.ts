import { Alert, Linking } from "react-native";
import * as Notifications from "expo-notifications";

import { hasAskedForPermission, markPermissionAsked, setNotificationsEnabled } from "./store";

/**
 * Notification permission, asked at the only moment it makes sense.
 *
 * iOS gives an app ONE system prompt, ever. Deny it and the only route back is
 * Settings, which nobody walks. So the system prompt is never fired cold: a
 * plain-language explanation goes first, and the system prompt only follows if
 * the user says yes to that. If they say no, we have spent nothing and can ask
 * again after the next recording.
 *
 * This is why nothing here runs at launch. At launch the user has no meetings,
 * no context, and no reason to say yes.
 */

/** iOS reports "provisional" as undetermined at the root; read the iOS block. */
function isGranted(permissions: Notifications.NotificationPermissionsStatus): boolean {
  if (permissions.granted) return true;

  const iosStatus = permissions.ios?.status;
  return (
    iosStatus === Notifications.IosAuthorizationStatus.AUTHORIZED ||
    iosStatus === Notifications.IosAuthorizationStatus.PROVISIONAL ||
    iosStatus === Notifications.IosAuthorizationStatus.EPHEMERAL
  );
}

export async function hasNotificationPermission(): Promise<boolean> {
  try {
    return isGranted(await Notifications.getPermissionsAsync());
  } catch {
    return false;
  }
}

/** The system prompt, with the iOS permission set this app actually uses. */
async function requestSystemPermission(): Promise<boolean> {
  try {
    const result = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
    return isGranted(result);
  } catch {
    return false;
  }
}

/** The framed explanation. Resolves true if the user wants to be asked. */
function askForConsent(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      "Get a nudge when it is ready",
      "Transcribing and summarizing a meeting takes a few minutes. Turn on notifications and Puffin will tell you the moment your summary and action items are ready, so you can put your phone away.",
      [
        { text: "Not now", style: "cancel", onPress: () => resolve(false) },
        { text: "Notify me", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/**
 * Ask for permission at the end of a recording.
 *
 * Returns whether notifications can now be posted. Safe to call on every stop;
 * it is a no-op once permission is settled in either direction.
 *
 * Deliberately NOT awaited for its side effects by the caller's happy path —
 * the upload should never wait on a dialog.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  // Already granted: nothing to ask, just make sure the preference agrees.
  if (await hasNotificationPermission()) {
    return true;
  }

  const permissions = await Notifications.getPermissionsAsync().catch(() => null);

  // Hard denial. iOS will not show the prompt again, so asking would present a
  // dialog whose "yes" button does nothing. Say nothing and move on.
  if (permissions && !permissions.canAskAgain) {
    await setNotificationsEnabled(false);
    return false;
  }

  // We already burned the system prompt in a previous session.
  if (await hasAskedForPermission()) {
    return false;
  }

  if (!(await askForConsent())) {
    // Explicit "not now" — the system prompt is untouched, so a later recording
    // can ask again. Nothing is recorded here on purpose.
    return false;
  }

  await markPermissionAsked();
  const granted = await requestSystemPermission();
  await setNotificationsEnabled(granted);
  return granted;
}

/**
 * Send the user to the app's page in Settings.
 *
 * The only recovery once iOS has recorded a denial. Bound by the settings
 * toggle, which is the one place a user has actively gone looking for this.
 */
export function openNotificationSettings(): void {
  void Linking.openSettings().catch(() => {
    // Nothing sensible to do; the toggle stays off and explains itself.
  });
}
