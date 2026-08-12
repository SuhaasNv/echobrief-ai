import "../global.css";

import { useCallback, useEffect, useRef, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";

import { createQueryClient, installQueryPlatformBindings } from "@/lib/query";
import { hydrateSession } from "@/lib/api/token-store";
import { subscribeToSessionEvents } from "@/lib/api/session-events";

// Hold the splash until the Keychain read resolves. Without this the auth guard
// runs against an empty in-memory cache and a signed-in user is flashed the
// sign-in screen on every cold start.
void SplashScreen.preventAutoHideAsync();

const queryClient = createQueryClient();

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  // Ref, not state: this is read inside callbacks and must never trigger a
  // render or be captured stale.
  const queryClientRef = useRef(queryClient);

  useEffect(() => {
    let cancelled = false;

    hydrateSession()
      .catch(() => {
        // A Keychain failure means no session, not a broken app — fall through
        // to the sign-in screen rather than hanging on the splash forever.
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => installQueryPlatformBindings(), []);

  useEffect(
    () =>
      subscribeToSessionEvents((event) => {
        if (event === "unauthorized") {
          // The client has already cleared the token by this point; drop cached
          // data so the next user cannot see the previous one's meetings.
          queryClientRef.current.clear();
          router.replace("/sign-in");
          return;
        }

        // A stale workspace id was cleared and the request retried against the
        // server's fallback workspace. Everything cached is scoped to the old
        // one, so it is all wrong now.
        void queryClientRef.current.invalidateQueries();
      }),
    [],
  );

  const onLayoutReady = useCallback(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }} onLayout={onLayoutReady}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          {/* Light content: the brand ground is near-black in both appearances. */}
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              // Delegates to UINavigationController, which brings the real
              // parallax push and the interactive back-swipe. 'slide_from_right'
              // is a flat JS reimplementation and reads as non-native.
              animation: "default",
              gestureEnabled: true,
              fullScreenGestureEnabled: true,
            }}
          >
            <Stack.Screen name="index" />
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(app)" />
          </Stack>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
