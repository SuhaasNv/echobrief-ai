import { AppState, type AppStateStatus } from "react-native";
import * as Network from "expo-network";
import { QueryClient, focusManager, onlineManager } from "@tanstack/react-query";
import { ApiError } from "@echobrief/shared/api";

/**
 * React Query gets two signals free in a browser that do not exist in React
 * Native: navigator.onLine and window focus. Without wiring them, queries never
 * refetch on reconnect and never refetch when the user returns to the app —
 * which on a phone is the single most common way the app becomes visible again.
 */

export function installQueryPlatformBindings(): () => void {
  // --- online state -------------------------------------------------------
  // expo-network avoids adding @react-native-community/netinfo, which we would
  // otherwise pull in solely for this.
  onlineManager.setEventListener((setOnline) => {
    let seenFirstEvent = false;

    const subscription = Network.addNetworkStateListener((state) => {
      seenFirstEvent = true;
      setOnline(Boolean(state.isConnected));
    });

    // The listener does not fire with the current value on subscribe, so seed
    // it — but skip if a real event already landed, to avoid clobbering fresher
    // state with a stale read.
    Network.getNetworkStateAsync()
      .then((state) => {
        if (!seenFirstEvent) setOnline(Boolean(state.isConnected));
      })
      .catch(() => {
        // Assume online. Treating an unknown network as offline would pause
        // every query and make the app look broken.
        if (!seenFirstEvent) setOnline(true);
      });

    return () => subscription.remove();
  });

  // --- focus state --------------------------------------------------------
  const onAppStateChange = (status: AppStateStatus) => {
    focusManager.setFocused(status === "active");
  };
  const appStateSubscription = AppState.addEventListener("change", onAppStateChange);

  return () => appStateSubscription.remove();
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Mobile networks are slow and metered; refetching on every mount is
        // wasteful. Screens that need freshness poll explicitly.
        staleTime: 30_000,
        retry: (failureCount, error) => {
          // 4xx are deterministic — retrying a 401, 403, 404, or a quota 429
          // just burns battery and delays the error state the UI needs to show.
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
            return false;
          }
          return failureCount < 2;
        },
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      },
      mutations: {
        retry: false,
      },
    },
  });
}
