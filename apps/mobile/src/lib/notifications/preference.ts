import { useCallback, useEffect, useState } from "react";
import * as Notifications from "expo-notifications";

import { hasNotificationPermission, openNotificationSettings } from "./permissions";
import {
  getNotificationState,
  setNotificationsEnabled,
  subscribeToNotificationState,
} from "./store";
import { syncBackgroundTaskRegistration } from "./task";

/**
 * The binding for a settings toggle.
 *
 * A notification switch has two independent pieces of state that users read as
 * one: the app's own preference, and the iOS permission. A switch bound only to
 * the preference happily shows ON while iOS silently drops every notification,
 * which is the worst possible outcome because nothing looks wrong.
 *
 * So `enabled` here is the AND of both, and flipping it on repairs whichever
 * half is missing: it requests permission if that is what is needed, and sends
 * the user to Settings if iOS has already recorded a denial and will not ask
 * again.
 */

export interface NotificationPreference {
  /** Bind the switch to this. True only when the app AND iOS both allow it. */
  enabled: boolean;
  /** False until the stored preference and the iOS status have been read. */
  ready: boolean;
  /** iOS permission, independent of the app preference. */
  permissionGranted: boolean;
  /**
   * True when iOS will not show the prompt again. The switch should explain
   * that turning it on opens Settings.
   */
  requiresSystemSettings: boolean;
  /** Flip the toggle. Handles permission repair; safe to call from onValueChange. */
  setEnabled: (next: boolean) => void;
  /** Deep link to the app's page in iOS Settings. */
  openSettings: () => void;
}

export function useNotificationPreference(): NotificationPreference {
  const [preferenceEnabled, setPreferenceEnabled] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [canAskAgain, setCanAskAgain] = useState(true);
  const [ready, setReady] = useState(false);

  const refreshPermission = useCallback(async () => {
    const granted = await hasNotificationPermission();
    setPermissionGranted(granted);

    const permissions = await Notifications.getPermissionsAsync().catch(() => null);
    setCanAskAgain(permissions?.canAskAgain ?? true);
    return granted;
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [state] = await Promise.all([getNotificationState(), refreshPermission()]);
      if (cancelled) return;

      setPreferenceEnabled(state.enabled);
      setReady(true);
    })();

    // Another surface (the record screen's permission prompt) can change this.
    const unsubscribe = subscribeToNotificationState((state) => {
      setPreferenceEnabled(state.enabled);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [refreshPermission]);

  const setEnabled = useCallback(
    (next: boolean) => {
      void (async () => {
        if (!next) {
          setPreferenceEnabled(false);
          await setNotificationsEnabled(false);
          // Nothing left to wake up for.
          await syncBackgroundTaskRegistration();
          return;
        }

        const granted = await refreshPermission();

        if (!granted) {
          const permissions = await Notifications.getPermissionsAsync().catch(() => null);

          if (permissions && !permissions.canAskAgain) {
            // iOS is done asking. Settings is the only way back.
            openNotificationSettings();
            return;
          }

          const result = await Notifications.requestPermissionsAsync({
            ios: { allowAlert: true, allowBadge: true, allowSound: true },
          }).catch(() => null);
          const nowGranted = result?.granted === true;

          setPermissionGranted(nowGranted);
          if (!nowGranted) {
            setCanAskAgain(false);
            return;
          }
        }

        setPreferenceEnabled(true);
        await setNotificationsEnabled(true);
        await syncBackgroundTaskRegistration();
      })();
    },
    [refreshPermission],
  );

  return {
    enabled: preferenceEnabled && permissionGranted,
    ready,
    permissionGranted,
    requiresSystemSettings: !permissionGranted && !canAskAgain,
    setEnabled,
    openSettings: openNotificationSettings,
  };
}
